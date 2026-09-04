import "server-only"

import { runQeoIndexEodPhase } from "../admin/job-phase-telemetry.ts"
import { getCanonicalUniverse } from "../market/universe/index.ts"
import { refreshOhlcvHistoryBatch, type OhlcvRefreshError } from "../market/history/ohlcv-store.ts"
import { classifyEodFailure, type EodTickerAttempt } from "./fault-isolation.ts"
import { nextTickerAttemptNumber, persistEodTickerAttempts } from "./ticker-telemetry.ts"
import { getSupabaseServerClient } from "../shared/supabase/server.ts"
import {
  loadWyckoffV2BuildArtifacts,
  loadWyckoffV2BuildArtifactsUnchecked,
  restageWyckoffV2BuildArtifacts,
  stageWyckoffV2BuildArtifacts,
} from "../wyckoff/eod-build-artifacts.ts"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "../wyckoff/eod-builder.ts"
import { loadWyckoffV2CachedHistoriesPartial, type WyckoffV2CachedHistory } from "../wyckoff/eod-cache-read.ts"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "../wyckoff/eod-contract.ts"
import type { WyckoffV2UniverseRow } from "../wyckoff/eod-universe.ts"

const HISTORY_RETRY_BATCH_SIZE = 10

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function failureAttempt(input: { ticker: string; stage: string; attempt: number; error: unknown }): EodTickerAttempt {
  const classified = classifyEodFailure(input.error, { stage: input.stage, ticker: input.ticker })
  return {
    ticker: input.ticker,
    stage: input.stage,
    status: "failed",
    errorClass: classified.errorClass,
    attempt: input.attempt,
    retryEligible: classified.retryEligible,
    error: input.error instanceof Error ? input.error.message : String(input.error),
    errorCode: String((input.error as { code?: unknown } | null)?.code || "TICKER_LOCAL_FAILURE"),
  }
}

function successAttempt(ticker: string, stage: string, attempt = 1): EodTickerAttempt {
  return { ticker, stage, status: "succeeded", errorClass: null, attempt, retryEligible: false }
}

function throwIfCriticalTickerFailure(attempts: readonly EodTickerAttempt[]) {
  const critical = attempts.find((attempt) => attempt.status === "failed" && attempt.errorClass === "critical_systemic")
  if (!critical) return
  throw Object.assign(
    new Error(`${critical.stage} critical systemic failure for ${critical.ticker}: ${critical.error || critical.errorCode || "unknown"}`),
    { code: critical.errorCode || "EOD_CRITICAL_SYSTEMIC_FAILURE" },
  )
}

export async function persistHistoryTickerAttemptsStep(runId: string, tickers: string[], errors: OhlcvRefreshError[]) {
  "use step"
  const failures = new Map(errors.map((item) => [item.ticker, item.error]))
  const attempts = tickers.map((ticker) => {
    const error = failures.get(ticker)
    return error
      ? failureAttempt({ ticker, stage: "HISTORY_REFRESH", attempt: 1, error })
      : successAttempt(ticker, "HISTORY_REFRESH")
  })
  await persistEodTickerAttempts(requiredSupabase(), runId, attempts)
  throwIfCriticalTickerFailure(attempts)
  return attempts
}

function buildSnapshots(stock: WyckoffV2UniverseRow, cached: WyckoffV2CachedHistory, runKey: string, scanDate: string) {
  return buildWyckoffV2TickerSnapshots({ stock, daily: cached.daily, runKey, scanDate })
}

export async function runWyckoffBuildIsolatedStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
  allowTickerFailures = true,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "WYCKOFF_BUILD",
    fn: async () => {
      const cache = await loadWyckoffV2CachedHistoriesPartial(requiredSupabase(), stocks.map((stock) => stock.ticker))
      const cacheErrors = new Map(cache.errors.map((item) => [item.ticker, item.error]))
      const providers = new Set<string>()
      const snapshots: WyckoffV2Snapshot[] = []
      const attempts: EodTickerAttempt[] = []

      for (const stock of stocks) {
        const cached = cache.histories.get(stock.ticker)
        if (!cached) {
          attempts.push(failureAttempt({
            ticker: stock.ticker,
            stage: "WYCKOFF_BUILD",
            attempt: 1,
            error: cacheErrors.get(stock.ticker) || `WYCKOFF_BUILD_CACHE_MISSING: ${stock.ticker}`,
          }))
          continue
        }
        try {
          providers.add(cached.daily.provider)
          snapshots.push(...buildSnapshots(stock, cached, runKey, scanDate))
          attempts.push(successAttempt(stock.ticker, "WYCKOFF_BUILD"))
        } catch (error) {
          attempts.push(failureAttempt({ ticker: stock.ticker, stage: "WYCKOFF_BUILD", attempt: 1, error }))
        }
      }

      await persistEodTickerAttempts(requiredSupabase(), runId, attempts)
      throwIfCriticalTickerFailure(attempts)
      const failedTickers = attempts.filter((attempt) => attempt.status === "failed").map((attempt) => attempt.ticker).sort()
      if (failedTickers.length && !allowTickerFailures) {
        throw Object.assign(new Error(`WYCKOFF_BUILD failed for ${failedTickers.join(",")}`), { code: "WYCKOFF_BUILD_FAILED" })
      }

      let validationHash: string | null = null
      let total = 0
      let complete = 0
      let incomplete = 0
      let artifactTickerCount = 0
      if (snapshots.length) {
        const validation = validateWyckoffV2SnapshotSet(runKey, snapshots)
        validationHash = computeWyckoffV2ValidationHash(snapshots)
        const staged = await stageWyckoffV2BuildArtifacts(requiredSupabase(), { runId, runKey, scanDate, validationHash, snapshots })
        total = validation.total
        complete = validation.complete
        incomplete = validation.incomplete
        artifactTickerCount = staged.tickerCount
      }

      return {
        total,
        complete,
        incomplete,
        validationHash,
        providers: [...providers].sort(),
        artifactTickerCount,
        healthyCount: stocks.length - failedTickers.length,
        failedCount: failedTickers.length,
        failedTickers,
        tickerAttempts: attempts,
      }
    },
    summarize: (result) => result,
  })
}

export async function runTargetedHistoryRetryStep(
  runId: string,
  tickers: string[],
  startedAtIso: string,
  priorAttempts: EodTickerAttempt[],
) {
  "use step"
  const allAttempts: EodTickerAttempt[] = []
  for (let offset = 0; offset < tickers.length; offset += HISTORY_RETRY_BATCH_SIZE) {
    const batch = tickers.slice(offset, offset + HISTORY_RETRY_BATCH_SIZE)
    const result = await refreshOhlcvHistoryBatch(requiredSupabase(), batch, new Date(startedAtIso))
    const failures = new Map(result.errors.map((item) => [item.ticker, item.error]))
    for (const ticker of batch) {
      const attempt = nextTickerAttemptNumber([...priorAttempts, ...allAttempts], ticker, "HISTORY_REFRESH")
      const error = failures.get(ticker)
      allAttempts.push(error
        ? failureAttempt({ ticker, stage: "HISTORY_REFRESH", attempt, error })
        : successAttempt(ticker, "HISTORY_REFRESH", attempt))
    }
  }
  await persistEodTickerAttempts(requiredSupabase(), runId, allAttempts)
  throwIfCriticalTickerFailure(allAttempts)
  return {
    tickerAttempts: allAttempts,
    succeededTickers: allAttempts.filter((attempt) => attempt.status === "succeeded").map((attempt) => attempt.ticker),
    failedTickers: allAttempts.filter((attempt) => attempt.status === "failed").map((attempt) => attempt.ticker),
  }
}

export async function runTargetedWyckoffRetryStep(
  runId: string,
  canonicalStocks: WyckoffV2UniverseRow[],
  targetTickers: string[],
  runKey: string,
  scanDate: string,
  priorAttempts: EodTickerAttempt[],
) {
  "use step"
  const targetSet = new Set(targetTickers)
  const targetStocks = canonicalStocks.filter((stock) => targetSet.has(stock.ticker))
  if (targetStocks.length !== targetSet.size) throw new Error("Targeted Wyckoff retry contains non-canonical ticker")

  const existing = await loadWyckoffV2BuildArtifactsUnchecked(requiredSupabase(), { runId, runKey, scanDate })
  const cache = await loadWyckoffV2CachedHistoriesPartial(requiredSupabase(), targetTickers)
  const cacheErrors = new Map(cache.errors.map((item) => [item.ticker, item.error]))
  const repairedByTicker = new Map<string, WyckoffV2Snapshot[]>()
  const retryAttempts: EodTickerAttempt[] = []

  for (const stock of targetStocks) {
    const attempt = nextTickerAttemptNumber([...priorAttempts, ...retryAttempts], stock.ticker, "WYCKOFF_BUILD")
    const cached = cache.histories.get(stock.ticker)
    if (!cached) {
      retryAttempts.push(failureAttempt({
        ticker: stock.ticker,
        stage: "WYCKOFF_BUILD",
        attempt,
        error: cacheErrors.get(stock.ticker) || `WYCKOFF_BUILD_CACHE_MISSING: ${stock.ticker}`,
      }))
      continue
    }
    try {
      repairedByTicker.set(stock.ticker, buildSnapshots(stock, cached, runKey, scanDate))
      retryAttempts.push(successAttempt(stock.ticker, "WYCKOFF_BUILD", attempt))
    } catch (error) {
      retryAttempts.push(failureAttempt({ ticker: stock.ticker, stage: "WYCKOFF_BUILD", attempt, error }))
    }
  }
  await persistEodTickerAttempts(requiredSupabase(), runId, retryAttempts)
  throwIfCriticalTickerFailure(retryAttempts)

  const existingByTicker = new Map<string, WyckoffV2Snapshot[]>()
  for (const snapshot of existing.snapshots) {
    const rows = existingByTicker.get(snapshot.ticker) || []
    rows.push(snapshot)
    existingByTicker.set(snapshot.ticker, rows)
  }
  const combined: WyckoffV2Snapshot[] = []
  for (const stock of canonicalStocks) {
    const snapshots = repairedByTicker.get(stock.ticker)
      || (!targetSet.has(stock.ticker) ? existingByTicker.get(stock.ticker) : undefined)
    if (snapshots) combined.push(...snapshots)
  }

  const staged = combined.length
    ? await restageWyckoffV2BuildArtifacts(requiredSupabase(), { runId, runKey, scanDate, snapshots: combined })
    : { tickerCount: 0, snapshotCount: 0, validationHash: null }
  return {
    tickerAttempts: retryAttempts,
    succeededTickers: retryAttempts.filter((attempt) => attempt.status === "succeeded").map((attempt) => attempt.ticker),
    failedTickers: retryAttempts.filter((attempt) => attempt.status === "failed").map((attempt) => attempt.ticker),
    artifactTickerCount: staged.tickerCount,
    snapshotCount: staged.snapshotCount,
    validationHash: staged.validationHash,
  }
}

export async function revalidateFullCanonicalArtifactsStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
  expectedValidationHash: string,
  expectedUniverseRunId: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_VALIDATE",
    fn: async () => {
      const built = await loadWyckoffV2BuildArtifacts(requiredSupabase(), { runId, runKey, scanDate, expectedValidationHash })
      const canonical = await getCanonicalUniverse()
      if (canonical.runId !== expectedUniverseRunId) {
        throw Object.assign(new Error(`SUPABASE_VALIDATE universe changed ${canonical.runId} != ${expectedUniverseRunId}`), { code: "SUPABASE_VALIDATE_FAILED" })
      }
      const expectedTickers = stocks.map((stock) => stock.ticker).sort()
      const builtTickers = [...new Set(built.snapshots.map((snapshot) => snapshot.ticker))].sort()
      if (builtTickers.length !== expectedTickers.length || builtTickers.some((ticker, index) => ticker !== expectedTickers[index])) {
        throw Object.assign(new Error(`SUPABASE_VALIDATE canonical mismatch ${builtTickers.length}/${expectedTickers.length}`), { code: "SUPABASE_VALIDATE_FAILED" })
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
