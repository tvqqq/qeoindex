import "server-only"

import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { refreshOhlcvHistoryBatch, type OhlcvUniverseRefreshResult } from "@/lib/ohlcv-history-store"
import { loadMarketSynthesisContext } from "@/lib/qeoindex-eod-market-synthesis-step"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import {
  loadWyckoffV2BuildArtifacts,
  stageWyckoffV2BuildArtifacts,
} from "@/lib/wyckoff-v2-build-artifacts"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2CachedHistories } from "@/lib/wyckoff-v2-cache-read"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "@/lib/wyckoff-v2-contract"
import type { WyckoffV2UniverseRow } from "@/lib/wyckoff-v2-universe"
import { publishWyckoffV2SnapshotsDirect } from "@/lib/wyckoff-supabase-publish"

export {
  runCompleteStep,
  runEodReadyStep,
  runMarketCloseCollectStep,
  startQeoIndexEodRunStep,
} from "./qeoindex-eod-runtime-steps"
export { runMarketSynthesisStep } from "./qeoindex-eod-market-synthesis-step"

export const HISTORY_REFRESH_BATCH_SIZE = 10
const HISTORY_REFRESH_WINDOW_CONCURRENCY_MAX = 4

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

async function refreshHistoryBatch(
  stocks: WyckoffV2UniverseRow[],
  startedAtIso: string,
  allowRecoverableFailures: boolean,
) {
  if (stocks.length < 1 || stocks.length > HISTORY_REFRESH_BATCH_SIZE) {
    throw Object.assign(
      new Error(`HISTORY_REFRESH batch must contain 1-${HISTORY_REFRESH_BATCH_SIZE} tickers; received ${stocks.length}`),
      { code: "HISTORY_REFRESH_FAILED" },
    )
  }
  const result = await refreshOhlcvHistoryBatch(
    requiredSupabase(),
    stocks.map((stock) => stock.ticker),
    new Date(startedAtIso),
  )
  const accountedTickers = result.completedTickers + result.failedTickers
  if (result.requestedTickers !== stocks.length || accountedTickers !== result.requestedTickers) {
    throw Object.assign(
      new Error(
        `HISTORY_REFRESH batch accounting incomplete: `
        + `${result.completedTickers} completed + ${result.failedTickers} failed `
        + `!= ${result.requestedTickers} requested for ${stocks.length} input tickers`,
      ),
      { code: "HISTORY_REFRESH_FAILED" },
    )
  }
  if (result.failedTickers > 0 && !allowRecoverableFailures) {
    throw Object.assign(
      new Error(
        `HISTORY_REFRESH failed for ${result.failedTickers} ticker(s): `
        + result.errors.slice(0, 5).map((item) => `${item.ticker}: ${item.error}`).join(" | "),
      ),
      { code: "HISTORY_REFRESH_FAILED" },
    )
  }
  return result
}

async function refreshHistoryWindow(
  stocks: WyckoffV2UniverseRow[],
  startedAtIso: string,
  progress: OhlcvUniverseRefreshResult,
  concurrency: number,
  allowRecoverableFailures: boolean,
) {
  const chunks: WyckoffV2UniverseRow[][] = []
  for (let offset = 0; offset < stocks.length; offset += HISTORY_REFRESH_BATCH_SIZE) {
    chunks.push(stocks.slice(offset, offset + HISTORY_REFRESH_BATCH_SIZE))
  }
  if (chunks.length > concurrency) {
    throw Object.assign(
      new Error(`HISTORY_REFRESH window fan-out ${chunks.length} exceeds bounded concurrency ${concurrency}`),
      { code: "HISTORY_REFRESH_CONCURRENCY_INVALID" },
    )
  }
  const results = await Promise.all(
    chunks.map((chunk) => refreshHistoryBatch(chunk, startedAtIso, allowRecoverableFailures)),
  )
  return results.reduce(mergeHistoryRefreshProgress, progress)
}

export async function runHistoryRefreshWindowStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  startedAtIso: string,
  progress: OhlcvUniverseRefreshResult,
  concurrency: number,
  allowRecoverableFailures = false,
) {
  "use step"
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > HISTORY_REFRESH_WINDOW_CONCURRENCY_MAX) {
    throw Object.assign(
      new Error(`HISTORY_REFRESH concurrency must be 1-${HISTORY_REFRESH_WINDOW_CONCURRENCY_MAX}; received ${concurrency}`),
      { code: "HISTORY_REFRESH_CONCURRENCY_INVALID" },
    )
  }
  const maxWindowSize = HISTORY_REFRESH_BATCH_SIZE * concurrency
  if (stocks.length < 1 || stocks.length > maxWindowSize) {
    throw Object.assign(
      new Error(`HISTORY_REFRESH window must contain 1-${maxWindowSize} tickers; received ${stocks.length}`),
      { code: "HISTORY_REFRESH_FAILED" },
    )
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "HISTORY_REFRESH",
    fn: () => refreshHistoryWindow(stocks, startedAtIso, progress, concurrency, allowRecoverableFailures),
    summarize: (result) => ({
      requestedTickers: result.requestedTickers,
      completedTickers: result.completedTickers,
      failedTickers: result.failedTickers,
      dailyFetchedBars: result.dailyFetchedBars,
      backfillOperations: result.backfillOperations,
      deltaOperations: result.deltaOperations,
      limitedCoverageCount: result.limitedCoverage.length,
      errors: result.errors.slice(0, 5),
      boundedConcurrency: concurrency,
      batchSize: HISTORY_REFRESH_BATCH_SIZE,
    }),
  })
}

export async function runHistoryRefreshBatchStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  startedAtIso: string,
  progress: OhlcvUniverseRefreshResult,
  allowRecoverableFailures = false,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "HISTORY_REFRESH",
    fn: () => refreshHistoryWindow(stocks, startedAtIso, progress, 1, allowRecoverableFailures),
    summarize: (result) => ({
      requestedTickers: result.requestedTickers,
      completedTickers: result.completedTickers,
      failedTickers: result.failedTickers,
      dailyFetchedBars: result.dailyFetchedBars,
      backfillOperations: result.backfillOperations,
      deltaOperations: result.deltaOperations,
      limitedCoverageCount: result.limitedCoverage.length,
      errors: result.errors.slice(0, 5),
      boundedConcurrency: 1,
      batchSize: HISTORY_REFRESH_BATCH_SIZE,
    }),
  })
}

async function buildAllSnapshots(stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string) {
  const histories = await loadWyckoffV2CachedHistories(
    requiredSupabase(),
    stocks.map((stock) => stock.ticker),
  )
  const providers = new Set<string>()
  const snapshots: WyckoffV2Snapshot[] = []

  for (const stock of stocks) {
    const history = histories.get(stock.ticker)
    if (!history) throw new Error(`WYCKOFF_BUILD_CACHE_MISSING: ${stock.ticker}`)
    providers.add(history.daily.provider)
    snapshots.push(...buildWyckoffV2TickerSnapshots({
      stock,
      daily: history.daily,
      runKey,
      scanDate,
    }))
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
      const staged = await stageWyckoffV2BuildArtifacts(requiredSupabase(), {
        runId,
        runKey,
        scanDate,
        validationHash: built.validationHash,
        snapshots: built.snapshots,
      })
      if (staged.tickerCount !== stocks.length || staged.snapshotCount !== built.validation.total) {
        throw Object.assign(
          new Error(`WYCKOFF_BUILD artifact staging mismatch ${staged.tickerCount}/${stocks.length} tickers`),
          { code: "WYCKOFF_BUILD_FAILED" },
        )
      }
      return {
        total: built.validation.total,
        complete: built.validation.complete,
        incomplete: built.validation.incomplete,
        validationHash: built.validationHash,
        providers: built.providers,
        artifactTickerCount: staged.tickerCount,
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
  expectedValidationHash: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_VALIDATE",
    fn: async () => {
      const built = await loadWyckoffV2BuildArtifacts(requiredSupabase(), {
        runId,
        runKey,
        scanDate,
        expectedValidationHash,
      })
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
      if (builtTickers.length !== stocks.length || built.tickerCount !== stocks.length) {
        throw Object.assign(
          new Error(`SUPABASE_VALIDATE stock payload mismatch ${builtTickers.length}/${stocks.length}`),
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
  runKey: string,
  scanDate: string,
  expectedValidationHash: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_PUBLISH",
    fn: async () => {
      const built = await loadWyckoffV2BuildArtifacts(requiredSupabase(), {
        runId,
        runKey,
        scanDate,
        expectedValidationHash,
      })
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
  const marketSynthesis = await loadMarketSynthesisContext(ratingDate)
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_LLM",
    fn: () => runAiCouncilDebateOperation(requiredSupabase(), ratingDate, marketSynthesis),
    summarize: (result) => ({
      ok: result.ok,
      status: result.status,
      ratingDate: result.ratingDate,
      reason: "reason" in result ? result.reason : undefined,
      selected: "selected" in result ? result.selected : undefined,
      completed: "completed" in result ? result.completed : undefined,
      totalTokens: "totalTokens" in result ? result.totalTokens : undefined,
      marketSynthesisEvidenceHash: marketSynthesis?.evidenceHash,
      marketSynthesisPosture: marketSynthesis?.posture,
    }),
  })
}
