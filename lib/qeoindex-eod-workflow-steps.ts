import "server-only"

import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import {
  archiveCanonicalUniverseBatchToNotion,
  archiveEodTickerBatchToNotion,
  type EodArchiveCheckpoint,
} from "@/lib/qeoindex-eod-archive"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { refreshOhlcvHistoryBatch, type OhlcvUniverseRefreshResult } from "@/lib/ohlcv-history-store"
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
  runDriveArchiveStep,
  runEodReadyStep,
  runMarketCloseCollectStep,
  runMarketSynthesisStep,
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
  allowRecoverableFailures = false,
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
      return mergeHistoryRefreshProgress(progress, result)
    },
    summarize: (result) => ({
      requestedTickers: result.requestedTickers,
      completedTickers: result.completedTickers,
      failedTickers: result.failedTickers,
      dailyFetchedBars: result.dailyFetchedBars,
      backfillOperations: result.backfillOperations,
      deltaOperations: result.deltaOperations,
      limitedCoverageCount: result.limitedCoverage.length,
      errors: result.errors.slice(0, 5),
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

function archiveFailure(error: unknown, requested: number): EodArchiveCheckpoint {
  return {
    status: "error",
    archived: 0,
    requested,
    detail: error instanceof Error ? error.message : String(error),
  }
}

function aggregateArchiveCheckpoints(checkpoints: EodArchiveCheckpoint[]): EodArchiveCheckpoint {
  if (!checkpoints.length) return { status: "skipped", archived: 0, requested: 0, detail: "No archive batches" }
  const statuses = checkpoints.map((checkpoint) => checkpoint.status)
  const status: EodArchiveCheckpoint["status"] = statuses.every((value) => value === "archived")
    ? "archived"
    : statuses.some((value) => value === "error")
      ? "error"
      : statuses.some((value) => value === "partial")
        ? "partial"
        : statuses.some((value) => value === "blocked")
          ? "blocked"
          : "skipped"
  return {
    status,
    archived: checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.archived || 0), 0),
    requested: checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.requested || 0), 0),
    detail: checkpoints.map((checkpoint) => checkpoint.detail).filter(Boolean).slice(0, 10).join(" | ") || undefined,
  }
}

function combinedArchiveStatus(
  universeArchive: EodArchiveCheckpoint,
  eodArchive: EodArchiveCheckpoint,
): EodArchiveCheckpoint["status"] {
  const statuses = [universeArchive.status, eodArchive.status]
  if (statuses.every((status) => status === "archived")) return "archived"
  if (statuses.some((status) => status === "error")) return "error"
  if (statuses.some((status) => status === "partial")) return "partial"
  if (statuses.some((status) => status === "blocked")) return "blocked"
  return "skipped"
}

export async function runNotionUniverseArchiveBatchStep(
  runId: string,
  input: { universeRunId: string },
  stocks: WyckoffV2UniverseRow[],
) {
  "use step"
  if (stocks.length < 1 || stocks.length > 8) {
    throw Object.assign(new Error(`NOTION_ARCHIVE universe batch must contain 1-8 tickers; received ${stocks.length}`), { code: "NOTION_ARCHIVE_FAILED" })
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_ARCHIVE",
    fn: async (): Promise<EodArchiveCheckpoint> => {
      try {
        const canonical = await getCanonicalUniverse()
        if (canonical.runId !== input.universeRunId) {
          return archiveFailure(new Error(`Canonical universe changed during Notion archive: ${canonical.runId} != ${input.universeRunId}`), stocks.length)
        }
        const requested = new Set(stocks.map((stock) => stock.ticker))
        const archiveStocks = canonical.stocks.filter((stock) => requested.has(stock.ticker))
        if (archiveStocks.length !== stocks.length) {
          return archiveFailure(new Error(`Canonical Notion universe batch mismatch ${archiveStocks.length}/${stocks.length}`), stocks.length)
        }
        const result = await archiveCanonicalUniverseBatchToNotion({
          universeRunId: canonical.runId,
          sourceDate: canonical.sourceAsOfDate,
          minMarketCapBillion: canonical.filters.minMarketCapBillion,
          minAverageVolume50d: canonical.filters.minAverageVolume50d,
          stocks: archiveStocks,
        })
        return {
          status: result.status,
          archived: result.archived,
          requested: result.requested,
          detail: [
            "detail" in result ? result.detail : undefined,
            "errors" in result && Array.isArray(result.errors) ? result.errors.slice(0, 5).join(" | ") : undefined,
          ].filter(Boolean).join(" | ") || undefined,
        }
      } catch (error) {
        return archiveFailure(error, stocks.length)
      }
    },
    summarize: (result) => ({ ...result, batchKind: "universe" }),
  })
}

export async function runNotionEodArchiveBatchStep(
  runId: string,
  input: { tradingDate: string; universeRunId: string; validationHash: string },
  stocks: WyckoffV2UniverseRow[],
) {
  "use step"
  if (stocks.length < 1 || stocks.length > 8) {
    throw Object.assign(new Error(`NOTION_ARCHIVE EOD batch must contain 1-8 tickers; received ${stocks.length}`), { code: "NOTION_ARCHIVE_FAILED" })
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_ARCHIVE",
    fn: async (): Promise<EodArchiveCheckpoint> => {
      try {
        const canonical = await getCanonicalUniverse()
        if (canonical.runId !== input.universeRunId) {
          return archiveFailure(new Error(`Canonical universe changed during EOD archive: ${canonical.runId} != ${input.universeRunId}`), stocks.length)
        }
        const requested = new Set(stocks.map((stock) => stock.ticker))
        const archiveStocks = canonical.stocks.filter((stock) => requested.has(stock.ticker))
        if (archiveStocks.length !== stocks.length) {
          return archiveFailure(new Error(`Canonical EOD archive batch mismatch ${archiveStocks.length}/${stocks.length}`), stocks.length)
        }
        return archiveEodTickerBatchToNotion(requiredSupabase(), {
          tradingDate: input.tradingDate,
          universeRunId: input.universeRunId,
          validationHash: input.validationHash,
          stocks: archiveStocks,
        })
      } catch (error) {
        return archiveFailure(error, stocks.length)
      }
    },
    summarize: (result) => ({ ...result, batchKind: "eod" }),
  })
}

export async function runNotionArchiveFinalizeStep(
  runId: string,
  universeBatches: EodArchiveCheckpoint[],
  eodBatches: EodArchiveCheckpoint[],
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_ARCHIVE",
    fn: async (): Promise<EodArchiveCheckpoint & { universeArchiveStatus: string }> => {
      const universeArchive = aggregateArchiveCheckpoints(universeBatches)
      const eodArchive = aggregateArchiveCheckpoints(eodBatches)
      return {
        status: combinedArchiveStatus(universeArchive, eodArchive),
        archived: Number(universeArchive.archived || 0) + Number(eodArchive.archived || 0),
        requested: Number(universeArchive.requested || 0) + Number(eodArchive.requested || 0),
        universeArchiveStatus: universeArchive.status,
        detail: [universeArchive.detail, eodArchive.detail].filter(Boolean).join(" | ") || undefined,
      }
    },
    summarize: (result) => result,
  })
}
