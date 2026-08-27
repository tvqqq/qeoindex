import { sleep } from "workflow"

import {
  annotateQeoIndexEodPhaseSummaryStep,
  markQeoIndexEodPhaseRetryingStep,
} from "@/lib/admin/job-phase-telemetry"
import { runEodBackfillReadyStep } from "@/lib/qeoindex-eod-backfill-ready-step"
import { failQeoIndexEodRunStep } from "@/lib/qeoindex-eod-failure-step"
import { runEodNoTradeDailyRepairStep } from "@/lib/qeoindex-eod-no-trade-repair-step"
import {
  runNotionStagingBatchStep,
  type NotionStagingProgress,
} from "@/lib/qeoindex-eod-notion-staging-batch"
import type { OhlcvUniverseRefreshResult } from "@/lib/ohlcv-history-store"

import {
  runEodReadyStep,
  runMarketCloseCollectStep,
  runHistoryRefreshBatchStep,
  runWyckoffBuildStep,
  runNotionValidateStep,
  runIngestStep,
  runSupabasePublishStep,
  runDeterministicCouncilStep,
  runLlmDebateStep,
  runCompleteStep,
  startQeoIndexEodRunStep,
} from "@/lib/qeoindex-eod-workflow-steps"

const MARKET_CLOSE_MAX_ATTEMPTS = 3
const MARKET_CLOSE_RETRY_INTERVAL_MS = 5 * 60_000

function retryAt(startedAtIso: string, attempt: number) {
  const startedAt = new Date(startedAtIso).getTime()
  return new Date(startedAt + attempt * 5 * 60_000)
}

function marketCloseRetryAt(startedAtIso: string, attempt: number) {
  const startedAt = new Date(startedAtIso).getTime()
  return new Date(startedAt + attempt * MARKET_CLOSE_RETRY_INTERVAL_MS)
}

function isEodNotReady(error: unknown) {
  return (error as { code?: unknown } | null)?.code === "EOD_NOT_READY"
}

function marketCloseErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isRetryableMarketCloseFailure(error: unknown) {
  const message = marketCloseErrorMessage(error)
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
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          ready = await runEodReadyStep(runId, startedAtIso)
          break
        } catch (error) {
          if (!isEodNotReady(error) || attempt === 4) throw error
          await sleep(retryAt(startedAtIso, attempt))
        }
      }
    }
    if (!ready) throw new Error("EOD_READY did not produce a pipeline context")

    const shouldBuild = ready.notionAction === "write"
    const shouldPublish = ready.notionAction !== "stop"
    const resumeSupabaseRunId = ready.notionAction === "resume" ? ready.notionSupabaseRunId : ""

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
                  lastError: marketCloseErrorMessage(error).slice(0, 500),
                },
              })
            } catch {
              // Preserve the collector failure as the canonical pipeline error.
            }
            throw error
          }

          const nextAttemptAt = marketCloseRetryAt(startedAtIso, attempt)
          await markQeoIndexEodPhaseRetryingStep({
            runId,
            phaseKey: "MARKET_CLOSE_COLLECT",
            attemptsUsed: attempt,
            nextAttemptAt: nextAttemptAt.toISOString(),
            lastError: marketCloseErrorMessage(error),
          })
          await sleep(marketCloseRetryAt(startedAtIso, attempt))
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
    if (shouldBuild) {
      for (let offset = 0; offset < ready.stocks.length; offset += 10) {
        history = await runHistoryRefreshBatchStep(
          runId,
          ready.stocks.slice(offset, offset + 10),
          startedAtIso,
          history,
          true,
        )
      }
      if (history.completedTickers !== 100 || history.requestedTickers !== 100) {
        throw new Error(`HISTORY_REFRESH completed ${history.completedTickers}/${history.requestedTickers} tickers; expected 100/100`)
      }
    } else {
      history = await runHistoryRefreshBatchStep(runId, [], startedAtIso, history, false)
    }

    const noTradeRepair = await runEodNoTradeDailyRepairStep(
      ready.stocks.map((stock) => stock.ticker),
      ready.scanDate,
      shouldBuild && !historicalBackfill,
    )

    const build = await runWyckoffBuildStep(runId, ready.stocks, ready.runKey, ready.scanDate, shouldBuild)
    let staging: NotionStagingProgress = {
      created: 0,
      updated: 0,
      skippedRows: 0,
      total: 0,
      providers: [],
    }
    if (shouldBuild) {
      for (let offset = 0; offset < ready.stocks.length; offset += 10) {
        staging = await runNotionStagingBatchStep(
          runId,
          ready.stocks.slice(offset, offset + 10),
          ready.runKey,
          ready.scanDate,
          staging,
          true,
        )
      }
      if (staging.total !== 500) {
        throw new Error(`NOTION_STAGING completed ${staging.total}/500 snapshots`)
      }
    } else {
      staging = await runNotionStagingBatchStep(runId, [], ready.runKey, ready.scanDate, staging, false)
    }

    const providerSummary = staging.providers.length
      ? `Persistent OHLCV cache providers: ${staging.providers.join(", ")}; 100 tickers; 500 snapshot contract.`
      : build.providers.length
        ? `Persistent OHLCV cache providers: ${build.providers.join(", ")}; 100 tickers; 500 snapshot contract.`
        : "Existing notion-unified-v2 Ready run."
    const validation = await runNotionValidateStep(runId, ready.runKey, ready.scanDate, startedAtIso, providerSummary, shouldBuild)
    const ingest = await runIngestStep(runId, ready.runKey, shouldPublish, resumeSupabaseRunId)
    const claimId = ingest.status === "claimed" || ingest.status === "resumed" ? ingest.supabaseRunId : ""
    const publish = await runSupabasePublishStep(runId, ready.runKey, claimId, shouldPublish && Boolean(claimId))
    const published = shouldPublish && publish.status !== "skipped"
    const deterministic = await runDeterministicCouncilStep(runId, published, ready.scanDate)
    const llm = await runLlmDebateStep(runId, published && deterministic.ok, ready.scanDate)
    const complete = await runCompleteStep(runId, {
      runKey: ready.runKey,
      scanDate: ready.scanDate,
      notionAction: ready.notionAction,
      historicalBackfill,
      rankWarnings: ready.rankWarnings.slice(0, 10),
      marketCloseStatus: marketClose.status,
      history,
      noTradeRepair,
      build,
      staging,
      validation,
      ingestStatus: ingest.status,
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      llmStatus: llm.status,
    }, !shouldPublish)

    return {
      ok: true as const,
      runId,
      runKey: ready.runKey,
      scanDate: ready.scanDate,
      notionAction: ready.notionAction,
      historicalBackfill,
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      llmStatus: llm.status,
      complete,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await failQeoIndexEodRunStep(runId, message)
    throw error
  }
}
