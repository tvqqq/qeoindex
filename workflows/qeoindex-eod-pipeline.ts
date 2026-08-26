import { sleep } from "workflow"

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
  failQeoIndexEodRunStep,
  startQeoIndexEodRunStep,
} from "@/lib/qeoindex-eod-workflow-steps"

function retryAt(startedAtIso: string, attempt: number) {
  const startedAt = new Date(startedAtIso).getTime()
  return new Date(startedAt + attempt * 5 * 60_000)
}

function isEodNotReady(error: unknown) {
  return (error as { code?: unknown } | null)?.code === "EOD_NOT_READY"
}

export async function qeoindexEodPipeline(startedAtIso: string) {
  "use workflow"

  const runId = await startQeoIndexEodRunStep(startedAtIso)
  try {
    let ready: Awaited<ReturnType<typeof runEodReadyStep>> | null = null
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        ready = await runEodReadyStep(runId, startedAtIso)
        break
      } catch (error) {
        if (!isEodNotReady(error) || attempt === 4) throw error
        await sleep(retryAt(startedAtIso, attempt))
      }
    }
    if (!ready) throw new Error("EOD_READY did not produce a pipeline context")

    const shouldBuild = ready.notionAction === "write"
    const shouldPublish = ready.notionAction !== "stop"

    const marketClose = await runMarketCloseCollectStep(runId, startedAtIso, true)
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
    const ingest = await runIngestStep(runId, ready.runKey, shouldPublish)
    const claimId = ingest.status === "claimed" ? ingest.supabaseRunId : ""
    const publish = await runSupabasePublishStep(runId, ready.runKey, claimId, shouldPublish && Boolean(claimId))
    const published = shouldPublish && publish.status !== "skipped"
    const deterministic = await runDeterministicCouncilStep(runId, published)
    const llm = await runLlmDebateStep(runId, published && deterministic.ok)
    const complete = await runCompleteStep(runId, {
      runKey: ready.runKey,
      scanDate: ready.scanDate,
      notionAction: ready.notionAction,
      rankWarnings: ready.rankWarnings.slice(0, 10),
      marketCloseStatus: marketClose.status,
      history,
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
