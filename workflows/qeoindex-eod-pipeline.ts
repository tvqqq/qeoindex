import { sleep } from "workflow"

import {
  annotateQeoIndexEodPhaseSummaryStep,
  markQeoIndexEodPhaseRetryingStep,
} from "@/lib/admin/job-phase-telemetry"
import { runEodBackfillReadyStep } from "@/lib/qeoindex-eod-backfill-ready-step"
import { failQeoIndexEodRunStep } from "@/lib/qeoindex-eod-failure-step"
import { runEodNoTradeDailyRepairStep } from "@/lib/qeoindex-eod-no-trade-repair-step"
import type { OhlcvUniverseRefreshResult } from "@/lib/ohlcv-history-store"
import {
  runCompleteStep,
  runDeterministicCouncilStep,
  runDriveArchiveStep,
  runEodReadyStep,
  runHistoryRefreshBatchStep,
  runLlmDebateStep,
  runMarketCloseCollectStep,
  runMarketSynthesisStep,
  runNotionArchiveStep,
  runRetentionCleanupStep,
  runSupabasePublishStep,
  runSupabaseValidateStep,
  runWyckoffBuildStep,
  startQeoIndexEodRunStep,
} from "@/lib/qeoindex-eod-workflow-steps"

const EOD_READY_MAX_ATTEMPTS = 4
const EOD_READY_RETRY_INTERVAL_MS = 5 * 60_000
const MARKET_CLOSE_MAX_ATTEMPTS = 3
const MARKET_CLOSE_RETRY_INTERVAL_MS = 5 * 60_000
const MAX_CANONICAL_UNIVERSE_SIZE = 200
const WYCKOFF_TIMEFRAME_COUNT = 5

function retryAt(startedAtIso: string, attempt: number, intervalMs: number) {
  const startedAt = new Date(startedAtIso).getTime()
  return new Date(startedAt + attempt * intervalMs)
}

function isEodNotReady(error: unknown) {
  return (error as { code?: unknown } | null)?.code === "EOD_NOT_READY"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableMarketCloseFailure(error: unknown) {
  const message = errorMessage(error)
  const normalized = message.toUpperCase()
  if (message.includes("failed to load dedicated sync secret")) return false
  if (/UNAUTHORIZED|FORBIDDEN|INVALID_SECRET|MISSING_SECRET/.test(normalized)) return false

  const statusFromError = Number((error as { status?: unknown } | null)?.status)
  const statusFromMessage = Number(normalized.match(/\bHTTP_(\d{3})\b/)?.[1])
  const httpStatus = Number.isFinite(statusFromError) && statusFromError > 0
    ? statusFromError
    : statusFromMessage
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

function vietnamDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

export async function qeoindexEodPipeline(startedAtIso: string) {
  "use workflow"

  const runId = await startQeoIndexEodRunStep(startedAtIso)
  try {
    const historicalBackfill = vietnamDateKey(startedAtIso) !== vietnamDateKey(new Date().toISOString())
    let ready:
      | Awaited<ReturnType<typeof runEodReadyStep>>
      | Awaited<ReturnType<typeof runEodBackfillReadyStep>>
      | null = null

    if (historicalBackfill) {
      ready = await runEodBackfillReadyStep(runId, startedAtIso)
    } else {
      for (let attempt = 1; attempt <= EOD_READY_MAX_ATTEMPTS; attempt += 1) {
        try {
          ready = await runEodReadyStep(runId, startedAtIso)
          break
        } catch (error) {
          if (!isEodNotReady(error) || attempt === EOD_READY_MAX_ATTEMPTS) throw error
          await sleep(retryAt(startedAtIso, attempt, EOD_READY_RETRY_INTERVAL_MS))
        }
      }
    }
    if (!ready) throw new Error("EOD_READY did not produce a pipeline context")

    const universeCount = ready.stocks.length
    if (universeCount < 1 || universeCount > MAX_CANONICAL_UNIVERSE_SIZE) {
      throw new Error(`Canonical universe count ${universeCount} is outside 1-${MAX_CANONICAL_UNIVERSE_SIZE}`)
    }
    const expectedSnapshots = universeCount * WYCKOFF_TIMEFRAME_COUNT

    let marketClose: Awaited<ReturnType<typeof runMarketCloseCollectStep>> | null = null
    if (historicalBackfill) {
      marketClose = await runMarketCloseCollectStep(runId, startedAtIso, false)
    } else {
      for (let attempt = 1; attempt <= MARKET_CLOSE_MAX_ATTEMPTS; attempt += 1) {
        try {
          marketClose = await runMarketCloseCollectStep(runId, startedAtIso, true)
          await annotateQeoIndexEodPhaseSummaryStep({
            runId,
            phaseKey: "MARKET_CLOSE_COLLECT",
            summary: {
              attemptsUsed: attempt,
              status: marketClose.status,
              sessionDate: marketClose.sessionDate,
              qualityStatus: "qualityStatus" in marketClose ? marketClose.qualityStatus : undefined,
              syncRunId: "syncRunId" in marketClose ? marketClose.syncRunId : undefined,
              retrying: false,
            },
          })
          break
        } catch (error) {
          const retryable = isRetryableMarketCloseFailure(error)
          if (!retryable || attempt === MARKET_CLOSE_MAX_ATTEMPTS) {
            try {
              await annotateQeoIndexEodPhaseSummaryStep({
                runId,
                phaseKey: "MARKET_CLOSE_COLLECT",
                summary: {
                  attemptsUsed: attempt,
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
        }
      }
    }
    if (!marketClose) throw new Error("MARKET_CLOSE_COLLECT did not produce a pipeline context")

    let history: OhlcvUniverseRefreshResult = {
      requestedTickers: 0,
      completedTickers: 0,
      failedTickers: 0,
      dailyFetchedBars: 0,
      hourlyFetchedBars: 0,
      backfillOperations: 0,
      deltaOperations: 0,
      limitedCoverage: [],
      errors: [],
    }
    for (let offset = 0; offset < ready.stocks.length; offset += 10) {
      history = await runHistoryRefreshBatchStep(
        runId,
        ready.stocks.slice(offset, offset + 10),
        startedAtIso,
        history,
      )
    }
    if (history.completedTickers !== universeCount || history.requestedTickers !== universeCount) {
      throw new Error(
        `HISTORY_REFRESH completed ${history.completedTickers}/${history.requestedTickers}`
        + `; expected ${universeCount}/${universeCount}`,
      )
    }

    const noTradeRepair = await runEodNoTradeDailyRepairStep(
      ready.stocks.map((stock) => stock.ticker),
      ready.scanDate,
      !historicalBackfill,
    )

    const build = await runWyckoffBuildStep(runId, ready.stocks, ready.runKey, ready.scanDate)
    if (build.total !== expectedSnapshots) {
      throw new Error(`WYCKOFF_BUILD completed ${build.total}/${expectedSnapshots} snapshots`)
    }

    const validation = await runSupabaseValidateStep(runId, ready.stocks, ready.runKey, ready.scanDate)
    if (validation.snapshotCount !== expectedSnapshots) {
      throw new Error(`SUPABASE_VALIDATE completed ${validation.snapshotCount}/${expectedSnapshots} snapshots`)
    }

    const publish = await runSupabasePublishStep(
      runId,
      ready.stocks,
      ready.runKey,
      ready.scanDate,
      validation.validationHash,
    )
    const published = publish.status === "published"

    const deterministic = await runDeterministicCouncilStep(runId, published, ready.scanDate)
    const llm = await runLlmDebateStep(runId, published && deterministic.ok, ready.scanDate)

    let marketSynthesis: Awaited<ReturnType<typeof runMarketSynthesisStep>> | {
      ok: false
      status: "failed"
      requestId: null
      ratingDate: string
      error: string
    }
    try {
      marketSynthesis = await runMarketSynthesisStep(
        runId,
        published && deterministic.ok,
        ready.scanDate,
      )
    } catch (error) {
      marketSynthesis = {
        ok: false,
        status: "failed",
        requestId: null,
        ratingDate: ready.scanDate,
        error: errorMessage(error),
      }
    }

    const notionArchive = await runNotionArchiveStep(runId, {
      tradingDate: ready.scanDate,
      universeRunId: ready.market.universeRunId,
      validationHash: validation.validationHash,
    })
    const driveArchive = await runDriveArchiveStep(runId, {
      tradingDate: ready.scanDate,
      universeRunId: ready.market.universeRunId,
      validationHash: validation.validationHash,
    })
    const retention = await runRetentionCleanupStep(runId, {
      startedAtIso,
      tradingDate: ready.scanDate,
      universeRunId: ready.market.universeRunId,
      universeCount,
      expectedSnapshots,
      completedSnapshots: publish.snapshotCount,
      validationHash: validation.validationHash,
      marketSynthesisStatus: marketSynthesis.status,
      notionArchive,
      driveArchive,
    })

    const complete = await runCompleteStep(runId, {
      runKey: ready.runKey,
      scanDate: ready.scanDate,
      universeRunId: ready.market.universeRunId,
      universeCount,
      expectedSnapshots,
      historicalBackfill,
      rankWarnings: ready.rankWarnings.slice(0, 10),
      marketCloseStatus: marketClose.status,
      history,
      noTradeRepair,
      build,
      validation,
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      llmStatus: llm.status,
      marketSynthesisStatus: marketSynthesis.status,
      notionArchiveStatus: notionArchive.status,
      driveArchiveStatus: driveArchive.status,
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
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      llmStatus: llm.status,
      marketSynthesisStatus: marketSynthesis.status,
      notionArchiveStatus: notionArchive.status,
      driveArchiveStatus: driveArchive.status,
      retentionStatus: retention.status,
      complete,
    }
  } catch (error) {
    await failQeoIndexEodRunStep(runId, errorMessage(error))
    throw error
  }
}
