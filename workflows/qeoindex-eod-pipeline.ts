import { sleep } from "workflow"

import {
  HISTORY_REFRESH_BATCH_SIZE,
  appendTickerAttempts,
  assertFrozenUniverseStillCurrent,
  assertReadyMatchesFrozenUniverse,
  completeQeoIndexEodPartialStep,
  computeEodTickerCoverage,
  failQeoIndexEodRunStep,
  persistHistoryTickerAttemptsStep,
  runCompleteStep,
  runDeterministicCouncilStep,
  runEodBackfillReadyStep,
  runEodNoTradeDailyRepairStep,
  runEodReadyStep,
  runHistoryRefreshWindowStep,
  runKfspRatingRefreshStep,
  runLlmDebateStep,
  runMarketCloseCollectStep,
  runMarketSynthesisStep,
  runNotionAnalyticalSummaryStep,
  runRetentionCleanupStep,
  runSupabasePublishStep,
  runSupabaseValidateStep,
  runTtaiRefreshStep,
  runWyckoffBuildIsolatedStep,
  runWyckoffBuildStep,
  skipQeoIndexEodRunStep,
  startQeoIndexEodRunStep,
  type EodTickerAttempt,
  type TtaiRefreshProgress,
} from "@/modules/eod"

import {
  annotateQeoIndexEodPhaseSummaryStep,
  markQeoIndexEodPhaseRetryingStep,
} from "@/modules/admin/job-phase-telemetry"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "@/modules/market/calendar"
import type { OhlcvUniverseRefreshResult } from "@/modules/market/history/ohlcv-store"

const EOD_READY_MAX_ATTEMPTS = 4
const EOD_READY_RETRY_INTERVAL_MS = 5 * 60_000
const MARKET_CLOSE_MAX_ATTEMPTS = 3
const MARKET_CLOSE_RETRY_INTERVAL_MS = 5 * 60_000
const MAX_CANONICAL_UNIVERSE_SIZE = 200
const WYCKOFF_TIMEFRAME_COUNT = 2
const TTAI_REFRESH_BATCH_SIZE = 50
const HISTORY_CONCURRENCY_DEFAULT = 2
const HISTORY_CONCURRENCY_MAX = 4
const QEOINDEX_EOD_HISTORY_CONCURRENCY = "QEOINDEX_EOD_HISTORY_CONCURRENCY"

type RatingRefresh = Awaited<ReturnType<typeof runKfspRatingRefreshStep>>
type MarketClose = Awaited<ReturnType<typeof runMarketCloseCollectStep>>

function retryAt(startedAtIso: string, attempt: number, intervalMs: number) {
  const startedAt = new Date(startedAtIso).getTime()
  return new Date(startedAt + attempt * intervalMs)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function historyConcurrencyLimit() {
  const configured = Number(process.env[QEOINDEX_EOD_HISTORY_CONCURRENCY] || HISTORY_CONCURRENCY_DEFAULT)
  if (!Number.isInteger(configured) || configured < 1) return HISTORY_CONCURRENCY_DEFAULT
  return Math.min(HISTORY_CONCURRENCY_MAX, configured)
}

function isEodNotReady(error: unknown) {
  if ((error as { code?: unknown } | null)?.code === "EOD_NOT_READY") return true
  const normalized = errorMessage(error).toUpperCase()
  return [
    "EOD_NOT_READY",
    "FINAL EOD MARKET SNAPSHOTS INCOMPLETE",
    "CANONICAL RATING UNIVERSE INCOMPLETE",
    "KFSP/TTAI RATING DATE",
    "CANONICAL WYCKOFF SELECTION MISMATCH",
    "CANONICAL MARKET UNIVERSE IS EMPTY",
  ].some((token) => normalized.includes(token))
}

function isRetryableMarketCloseFailure(error: unknown) {
  const message = errorMessage(error)
  const normalized = message.toUpperCase()
  if (message.includes("failed to load dedicated sync secret")) return false
  if (/UNAUTHORIZED|FORBIDDEN|INVALID_SECRET|MISSING_SECRET/.test(normalized)) return false

  const statusFromError = Number((error as { status?: unknown } | null)?.status)
  const statusFromMessage = Number(normalized.match(/\bHTTP_(\d{3})\b/)?.[1])
  const httpStatus = Number.isFinite(statusFromError) && statusFromError > 0 ? statusFromError : statusFromMessage
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return true

  return [
    "VALIDATION_FAILED",
    "P0_INCOMPLETE",
    "SOCKET",
    "TIMEOUT",
    "TIMED OUT",
    "NETWORK",
    "CONNECTION",
    "ECONN",
    "FETCH FAILED",
    "ABORT",
    "RATE_LIMIT",
    "TOO_MANY_REQUESTS",
    "SERVICE_UNAVAILABLE",
    "BAD_GATEWAY",
    "GATEWAY_TIMEOUT",
  ].some((token) => normalized.includes(token))
}

async function runTtaiRefreshBranch(runId: string, startedAtIso: string, ratingRefresh: RatingRefresh) {
  let progress: TtaiRefreshProgress | null = null
  for (let offset = 0; offset < ratingRefresh.universe.tickers.length; offset += TTAI_REFRESH_BATCH_SIZE) {
    progress = await runTtaiRefreshStep(
      runId,
      startedAtIso,
      ratingRefresh.universe,
      ratingRefresh.universe.tickers.slice(offset, offset + TTAI_REFRESH_BATCH_SIZE),
      progress || undefined,
    )
  }
  if (!progress || progress.checkedTickers !== ratingRefresh.universe.selectedCount) {
    throw new Error(
      `TTAI_REFRESH accounting mismatch ${progress?.checkedTickers || 0}/${ratingRefresh.universe.selectedCount}`,
    )
  }
  return progress
}

async function runMarketCloseBranch(runId: string, startedAtIso: string, ratingRefresh: RatingRefresh): Promise<MarketClose> {
  await assertFrozenUniverseStillCurrent(ratingRefresh.universe)
  for (let attempt = 1; attempt <= MARKET_CLOSE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const marketClose = await runMarketCloseCollectStep(runId, startedAtIso, true)
      await assertFrozenUniverseStillCurrent(ratingRefresh.universe)
      await annotateQeoIndexEodPhaseSummaryStep({
        runId,
        phaseKey: "MARKET_CLOSE_COLLECT",
        summary: {
          attemptsUsed: attempt,
          status: marketClose.status,
          sessionDate: marketClose.sessionDate,
          qualityStatus: "qualityStatus" in marketClose ? marketClose.qualityStatus : undefined,
          syncRunId: "syncRunId" in marketClose ? marketClose.syncRunId : undefined,
          universeRunId: ratingRefresh.universe.runId,
          retrying: false,
        },
      })
      return marketClose
    } catch (error) {
      const retryable = isRetryableMarketCloseFailure(error)
      if (!retryable || attempt === MARKET_CLOSE_MAX_ATTEMPTS) {
        try {
          await annotateQeoIndexEodPhaseSummaryStep({
            runId,
            phaseKey: "MARKET_CLOSE_COLLECT",
            summary: {
              attemptsUsed: attempt,
              universeRunId: ratingRefresh.universe.runId,
              retrying: false,
              terminal: true,
              lastError: errorMessage(error).slice(0, 500),
            },
          })
        } catch {
          // Preserve the collector failure as the canonical pipeline error.
        }
        throw error
      }
      const nextAttemptAt = retryAt(startedAtIso, attempt, MARKET_CLOSE_RETRY_INTERVAL_MS)
      await markQeoIndexEodPhaseRetryingStep({
        runId,
        phaseKey: "MARKET_CLOSE_COLLECT",
        attemptsUsed: attempt,
        nextAttemptAt: nextAttemptAt.toISOString(),
        lastError: errorMessage(error),
      })
      await sleep(nextAttemptAt)
      await assertFrozenUniverseStillCurrent(ratingRefresh.universe)
    }
  }
  throw new Error("MARKET_CLOSE_COLLECT did not produce a pipeline context")
}

export async function qeoindexEodPipeline(startedAtIso: string) {
  "use workflow"

  const runId = await startQeoIndexEodRunStep(startedAtIso)
  try {
    const requestedDate = vietnamDateKey(startedAtIso)
    if (!isVietnamSecuritiesTradingDateKey(requestedDate)) {
      return await skipQeoIndexEodRunStep(runId, requestedDate, "NON_TRADING_DAY")
    }

    const historicalBackfill = requestedDate !== vietnamDateKey(new Date().toISOString())
    let ready:
      | Awaited<ReturnType<typeof runEodReadyStep>>
      | Awaited<ReturnType<typeof runEodBackfillReadyStep>>
      | null = null
    let marketClose: MarketClose | null = null
    let ratingRefresh: RatingRefresh | null = null
    let ttaiRefresh: TtaiRefreshProgress | null = null

    if (historicalBackfill) {
      // Historical backfills stay Supabase-only: never substitute today's provider data into a past session.
      ready = await runEodBackfillReadyStep(runId, startedAtIso)
      marketClose = await runMarketCloseCollectStep(runId, startedAtIso, false)
    } else {
      ratingRefresh = await runKfspRatingRefreshStep(runId, startedAtIso)
      await assertFrozenUniverseStillCurrent(ratingRefresh.universe)

      ;[ttaiRefresh, marketClose] = await Promise.all([
        runTtaiRefreshBranch(runId, startedAtIso, ratingRefresh),
        runMarketCloseBranch(runId, startedAtIso, ratingRefresh),
      ])
      await assertFrozenUniverseStillCurrent(ratingRefresh.universe)

      for (let attempt = 1; attempt <= EOD_READY_MAX_ATTEMPTS; attempt += 1) {
        try {
          const candidateReady = await runEodReadyStep(runId, startedAtIso)
          await assertReadyMatchesFrozenUniverse({
            readyUniverseRunId: candidateReady.market.universeRunId,
            readyTickers: candidateReady.stocks.map((stock) => stock.ticker),
            expectedUniverse: ratingRefresh.universe,
          })
          ready = candidateReady
          await annotateQeoIndexEodPhaseSummaryStep({
            runId,
            phaseKey: "EOD_READY",
            summary: {
              runKey: candidateReady.runKey,
              scanDate: candidateReady.scanDate,
              universeCount: candidateReady.stocks.length,
              universeRunId: ratingRefresh.universe.runId,
              ratingDate: ratingRefresh.ratingDate,
              ratingSyncRunId: ratingRefresh.syncRunId,
              ttaiStatus: ttaiRefresh.status,
              ttaiSyncRunIds: ttaiRefresh.syncRunIds,
              ttaiFailedTickers: ttaiRefresh.failedTickers.slice(0, 20),
              freshMarketCount: candidateReady.market.freshMarketCount,
              attemptsUsed: attempt,
              architecture: "supabase-first-eod-v4-dag",
            },
          })
          break
        } catch (error) {
          if (!isEodNotReady(error) || attempt === EOD_READY_MAX_ATTEMPTS) throw error
          await sleep(retryAt(startedAtIso, attempt, EOD_READY_RETRY_INTERVAL_MS))
        }
      }
    }
    if (!ready) throw new Error("EOD_READY did not produce a pipeline context")
    if (!marketClose) throw new Error("MARKET_CLOSE_COLLECT did not produce a pipeline context")

    const universeCount = ready.stocks.length
    if (universeCount < 1 || universeCount > MAX_CANONICAL_UNIVERSE_SIZE) {
      throw new Error(`Canonical universe count ${universeCount} is outside 1-${MAX_CANONICAL_UNIVERSE_SIZE}`)
    }
    const expectedSnapshots = universeCount * WYCKOFF_TIMEFRAME_COUNT

    let history: OhlcvUniverseRefreshResult = {
      requestedTickers: 0,
      completedTickers: 0,
      failedTickers: 0,
      dailyFetchedBars: 0,
      backfillOperations: 0,
      deltaOperations: 0,
      limitedCoverage: [],
      errors: [],
    }
    const historyConcurrency = historyConcurrencyLimit()
    const historyWindowSize = HISTORY_REFRESH_BATCH_SIZE * historyConcurrency
    for (let offset = 0; offset < ready.stocks.length; offset += historyWindowSize) {
      history = await runHistoryRefreshWindowStep(
        runId,
        ready.stocks.slice(offset, offset + historyWindowSize),
        startedAtIso,
        history,
        historyConcurrency,
        !historicalBackfill,
      )
    }
    if (
      history.completedTickers + history.failedTickers !== universeCount
      || history.requestedTickers !== universeCount
    ) {
      throw new Error(
        `HISTORY_REFRESH accounting mismatch: `
        + `${history.completedTickers} completed + ${history.failedTickers} failed `
        + `/ ${history.requestedTickers} requested; expected ${universeCount}`,
      )
    }

    let tickerAttempts: EodTickerAttempt[] = []
    if (!historicalBackfill) {
      const historyAttempts = await persistHistoryTickerAttemptsStep(
        runId,
        ready.stocks.map((stock) => stock.ticker),
        history.errors,
      )
      tickerAttempts = appendTickerAttempts(tickerAttempts, historyAttempts)
    }

    const noTradeRepair = await runEodNoTradeDailyRepairStep(
      ready.stocks.map((stock) => stock.ticker),
      ready.scanDate,
      !historicalBackfill,
    )

    const build = historicalBackfill
      ? await runWyckoffBuildStep(runId, ready.stocks, ready.runKey, ready.scanDate)
      : await runWyckoffBuildIsolatedStep(runId, ready.stocks, ready.runKey, ready.scanDate, true)

    if (!historicalBackfill && "tickerAttempts" in build) {
      tickerAttempts = appendTickerAttempts(tickerAttempts, build.tickerAttempts)
      const coverage = computeEodTickerCoverage(
        ready.stocks.map((stock) => stock.ticker),
        tickerAttempts,
      )
      if (build.failedTickers.length > 0 || !coverage.complete) {
        return await completeQeoIndexEodPartialStep({
          runId,
          runKey: ready.runKey,
          scanDate: ready.scanDate,
          universeRunId: ready.market.universeRunId,
          coverage,
          tickerAttempts,
          summary: {
            universeCount,
            expectedSnapshots,
            historicalBackfill,
            historyConcurrency,
            history,
            noTradeRepair,
            build,
            healthyCount: coverage.healthyCount,
            failedCount: coverage.failedCount,
            ratingRefreshStatus: ratingRefresh?.status || null,
            ratingSyncRunId: ratingRefresh?.syncRunId || null,
            ttaiRefreshStatus: ttaiRefresh?.status || null,
            ttaiFailedTickers: ttaiRefresh?.failedTickers.slice(0, 20) || [],
            marketCloseStatus: marketClose.status,
          },
        })
      }
    }

    if (build.total !== expectedSnapshots || !build.validationHash) {
      throw new Error(`WYCKOFF_BUILD completed ${build.total}/${expectedSnapshots} snapshots`)
    }

    const validation = await runSupabaseValidateStep(
      runId,
      ready.stocks,
      ready.runKey,
      ready.scanDate,
      build.validationHash,
    )
    if (validation.snapshotCount !== expectedSnapshots) throw new Error(`SUPABASE_VALIDATE completed ${validation.snapshotCount}/${expectedSnapshots} snapshots`)

    const publish = await runSupabasePublishStep(
      runId,
      ready.runKey,
      ready.scanDate,
      validation.validationHash,
    )
    const published = publish.status === "published"

    const deterministic = await runDeterministicCouncilStep(runId, published, ready.scanDate)

    let marketSynthesis: Awaited<ReturnType<typeof runMarketSynthesisStep>> | {
      ok: false
      status: "failed"
      requestId: null
      ratingDate: string
      error: string
    }
    try {
      marketSynthesis = await runMarketSynthesisStep(runId, published && deterministic.ok, ready.scanDate)
    } catch (error) {
      marketSynthesis = { ok: false, status: "failed", requestId: null, ratingDate: ready.scanDate, error: errorMessage(error) }
    }

    const llm = await runLlmDebateStep(runId, published && deterministic.ok, ready.scanDate)

    const retention = await runRetentionCleanupStep(runId, { tradingDate: ready.scanDate })
    const summaryAnomalies = [
      ...ready.rankWarnings.slice(0, 20),
      ...(ttaiRefresh?.failedTickers || []).slice(0, 20).map((ticker) => `TTAI refresh failed: ${ticker}`),
      ...history.errors.slice(0, 20).map((item) => `${item.ticker}: ${item.error}`),
      ...(marketSynthesis.status === "failed" && "error" in marketSynthesis ? [`Market synthesis: ${marketSynthesis.error}`] : []),
      ...(retention.status !== "archived" && retention.detail ? [`Retention: ${retention.detail}`] : []),
    ]
    const runStatus = retention.status === "archived" && marketSynthesis.status !== "failed" ? "Succeeded" as const : "Partial" as const
    const notionArchive = await runNotionAnalyticalSummaryStep(runId, {
      tradingDate: ready.scanDate,
      runStatus,
      universeRunId: ready.market.universeRunId,
      universeCount,
      expectedSnapshots,
      completedSnapshots: publish.snapshotCount,
      validationHash: validation.validationHash,
      startedAt: startedAtIso,
      marketSynthesisStatus: marketSynthesis.status,
      tickers: ready.stocks.map((stock) => stock.ticker),
      failedTickers: [],
      anomalies: summaryAnomalies,
      retention,
    })

    const complete = await runCompleteStep(runId, {
      runKey: ready.runKey,
      scanDate: ready.scanDate,
      universeRunId: ready.market.universeRunId,
      universeCount,
      expectedSnapshots,
      historicalBackfill,
      rankWarnings: ready.rankWarnings.slice(0, 10),
      ratingRefreshStatus: ratingRefresh?.status || "historical_backfill",
      ratingSyncRunId: ratingRefresh?.syncRunId || null,
      ttaiRefreshStatus: ttaiRefresh?.status || "historical_backfill",
      ttaiFailedTickers: ttaiRefresh?.failedTickers.slice(0, 20) || [],
      marketCloseStatus: marketClose.status,
      historyConcurrency,
      history,
      noTradeRepair,
      build,
      tickerAttempts,
      healthyCount: universeCount,
      failedCount: 0,
      validation,
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      marketSynthesisStatus: marketSynthesis.status,
      llmStatus: llm.status,
      notionArchiveStatus: notionArchive.status,
      retentionStatus: retention.status,
      validationHash: validation.validationHash,
    })

    return {
      ok: true as const,
      runId,
      runKey: ready.runKey,
      scanDate: ready.scanDate,
      universeRunId: ready.market.universeRunId,
      universeCount,
      expectedSnapshots,
      historicalBackfill,
      healthyCount: universeCount,
      failedCount: 0,
      ratingRefreshStatus: ratingRefresh?.status || "historical_backfill",
      ttaiRefreshStatus: ttaiRefresh?.status || "historical_backfill",
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      marketSynthesisStatus: marketSynthesis.status,
      llmStatus: llm.status,
      notionArchiveStatus: notionArchive.status,
      retentionStatus: retention.status,
      complete,
    }
  } catch (error) {
    await failQeoIndexEodRunStep(runId, errorMessage(error))
    throw error
  }
}
