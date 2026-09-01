import "server-only"

import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { refreshOhlcvHistoryBatch, type OhlcvUniverseRefreshResult } from "@/lib/ohlcv-history-store"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2CachedTickerHistory } from "@/lib/wyckoff-v2-cache-read"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "@/lib/wyckoff-v2-contract"
import type { WyckoffV2UniverseRow } from "@/lib/wyckoff-v2-universe"
import { publishWyckoffV2SnapshotsDirect } from "@/lib/wyckoff-supabase-publish"

export {
  runCompleteStep,
  runDriveArchiveStep,
  runEodReadyStep,
  runMarketCloseCollectStep,
  runMarketSynthesisStep,
  runNotionArchiveStep,
  runRetentionCleanupStep,
  startQeoIndexEodRunStep,
} from "./qeoindex-eod-workflow-steps-legacy"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function mergeHistoryRefreshProgress(
  previous: OhlcvUniverseRefreshResult,
  current: OhlcvUniverseRefreshResult,
): OhlcvUniverseRefreshResult {
  return {
    requestedTickers: previous.requestedTickers + current.requestedTickers,
    completedTickers: previous.completedTickers + current.completedTickers,
    failedTickers: previous.failedTickers + current.failedTickers,
    dailyFetchedBars: previous.dailyFetchedBars + current.dailyFetchedBars,
    backfillOperations: previous.backfillOperations + current.backfillOperations,
    deltaOperations: previous.deltaOperations + current.deltaOperations,
    limitedCoverage: [...previous.limitedCoverage, ...current.limitedCoverage],
    errors: [...previous.errors, ...current.errors],
  }
}

export async function runHistoryRefreshBatchStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  startedAtIso: string,
  progress: OhlcvUniverseRefreshResult,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "HISTORY_REFRESH",
    fn: async () => {
      if (stocks.length < 1 || stocks.length > 10) {
        throw Object.assign(
          new Error(`HISTORY_REFRESH batch must contain 1-10 tickers; received ${stocks.length}`),
          { code: "HISTORY_REFRESH_FAILED" },
        )
      }
      const result = await refreshOhlcvHistoryBatch(
        requiredSupabase(),
        stocks.map((stock) => stock.ticker),
        new Date(startedAtIso),
      )
      if (result.failedTickers > 0) {
        throw Object.assign(
          new Error(
            `HISTORY_REFRESH failed for ${result.failedTickers} ticker(s): `
            + result.errors.slice(0, 5).map((item) => `${item.ticker}: ${item.error}`).join(" | "),
          ),
          { code: "HISTORY_REFRESH_FAILED" },
        )
      }
      if (result.completedTickers !== result.requestedTickers) {
        throw Object.assign(
          new Error(`HISTORY_REFRESH batch completed ${result.completedTickers}/${result.requestedTickers} tickers`),
          { code: "HISTORY_REFRESH_FAILED" },
        )
      }
      return mergeHistoryRefreshProgress(progress, result)
    },
    summarize: (result) => ({
      requestedTickers: result.requestedTickers,
      completedTickers: result.completedTickers,
      dailyFetchedBars: result.dailyFetchedBars,
      backfillOperations: result.backfillOperations,
      deltaOperations: result.deltaOperations,
      limitedCoverageCount: result.limitedCoverage.length,
    }),
  })
}

async function buildAllSnapshots(stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string) {
  const supabase = requiredSupabase()
  const snapshots: WyckoffV2Snapshot[] = []
  const providers = new Set<string>()

  for (let offset = 0; offset < stocks.length; offset += 10) {
    const batch = await Promise.all(stocks.slice(offset, offset + 10).map(async (stock) => {
      const history = await loadWyckoffV2CachedTickerHistory(supabase, stock.ticker)
      providers.add(history.daily.provider)
      return buildWyckoffV2TickerSnapshots({
        stock,
        daily: history.daily,
        runKey,
        scanDate,
      })
    }))
    snapshots.push(...batch.flat())
  }

  const expectedSnapshots = stocks.length * 2
  if (snapshots.length !== expectedSnapshots) {
    throw new Error(`Expected ${expectedSnapshots} Wyckoff snapshots; received ${snapshots.length}`)
  }
  const validation = validateWyckoffV2SnapshotSet(runKey, snapshots)
  const validationHash = computeWyckoffV2ValidationHash(snapshots)
  return { snapshots, validation, validationHash, providers: [...providers].sort() }
}

export async function runWyckoffBuildStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "WYCKOFF_BUILD",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      return {
        total: built.validation.total,
        complete: built.validation.complete,
        incomplete: built.validation.incomplete,
        validationHash: built.validationHash,
        providers: built.providers,
      }
    },
    summarize: (result) => result,
  })
}

export async function runSupabaseValidateStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_VALIDATE",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      const canonical = await getCanonicalUniverse()
      const builtTickers = [...new Set(built.snapshots.map((snapshot) => snapshot.ticker))].sort()
      const canonicalTickers = canonical.stocks.map((stock) => stock.ticker).sort()
      const missing = canonicalTickers.filter((ticker) => !builtTickers.includes(ticker))
      const unexpected = builtTickers.filter((ticker) => !canonicalTickers.includes(ticker))
      if (builtTickers.length !== canonical.selectedCount || missing.length > 0 || unexpected.length > 0) {
        throw Object.assign(
          new Error(
            `SUPABASE_VALIDATE canonical mismatch ${builtTickers.length}/${canonical.selectedCount}`
            + `${missing.length ? `; missing=${missing.slice(0, 20).join(",")}` : ""}`
            + `${unexpected.length ? `; unexpected=${unexpected.slice(0, 20).join(",")}` : ""}`,
          ),
          { code: "SUPABASE_VALIDATE_FAILED" },
        )
      }
      return {
        ok: true as const,
        validationHash: built.validationHash,
        universeRunId: canonical.runId,
        tickerCount: builtTickers.length,
        snapshotCount: built.validation.total,
        complete: built.validation.complete,
        incomplete: built.validation.incomplete,
      }
    },
    summarize: (result) => result,
  })
}

export async function runSupabasePublishStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
  expectedValidationHash: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_PUBLISH",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      if (built.validationHash !== expectedValidationHash) {
        throw Object.assign(
          new Error(`SUPABASE_PUBLISH validation hash changed: ${built.validationHash} != ${expectedValidationHash}`),
          { code: "SUPABASE_PUBLISH_FAILED" },
        )
      }
      return publishWyckoffV2SnapshotsDirect(requiredSupabase(), {
        snapshots: built.snapshots,
        runKey,
        scanDate,
        runId,
      })
    },
    summarize: (result) => ({
      status: result.status,
      runKey: result.runKey,
      universeRunId: result.universeRunId,
      tickerCount: result.tickerCount,
      snapshotCount: result.snapshotCount,
      chartSeriesCount: result.chartSeriesCount,
      validationHash: result.validationHash,
    }),
  })
}

export async function runDeterministicCouncilStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "AI_COUNCIL_DETERMINISTIC",
      reason: "Supabase Wyckoff publish did not complete.",
    })
    return { ok: false as const, status: "skipped" as const, reason: "SUPABASE_NOT_PUBLISHED" as const }
  }
  const operationDate = ratingDate ? new Date(`${ratingDate}T08:15:00.000Z`) : new Date()
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_DETERMINISTIC",
    fn: () => runAiCouncilDailyOperation(requiredSupabase(), operationDate, ratingDate),
    summarize: (result) => ({
      ok: result.ok,
      status: result.status,
      ratingDate: result.ratingDate,
      reason: "reason" in result ? result.reason : undefined,
      stockCount: "stockCount" in result ? result.stockCount : undefined,
    }),
  })
}

export async function runLlmDebateStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "AI_COUNCIL_LLM",
      reason: "Deterministic Council did not complete.",
    })
    return { ok: false as const, status: "skipped" as const, reason: "DETERMINISTIC_NOT_READY" as const }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_LLM",
    fn: () => runAiCouncilDebateOperation(requiredSupabase(), ratingDate),
    summarize: (result) => ({
      ok: result.ok,
      status: result.status,
      ratingDate: result.ratingDate,
      reason: "reason" in result ? result.reason : undefined,
      selected: "selected" in result ? result.selected : undefined,
      completed: "completed" in result ? result.completed : undefined,
      totalTokens: "totalTokens" in result ? result.totalTokens : undefined,
    }),
  })
}
