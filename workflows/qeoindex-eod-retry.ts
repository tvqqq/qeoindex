import {
  appendTickerAttempts,
  computeEodTickerCoverage,
  latestTickerStageAttempts,
  selectRetryTickers,
} from "@/lib/qeoindex-eod-fault-isolation"
import {
  revalidateFullCanonicalArtifactsStep,
  runTargetedHistoryRetryStep,
  runTargetedWyckoffRetryStep,
} from "@/lib/qeoindex-eod-fault-steps"
import { completeQeoIndexEodPartialStep } from "@/lib/qeoindex-eod-partial-step"
import { completeRecoveredEodRunStep, loadEodRetryContextStep } from "@/lib/qeoindex-eod-retry-steps"
import { runRetentionCleanupStep } from "@/lib/qeoindex-eod-retention-step"
import {
  runDeterministicCouncilStep,
  runLlmDebateStep,
  runMarketSynthesisStep,
  runNotionArchiveFinalizeStep,
  runNotionEodArchiveBatchStep,
  runNotionUniverseArchiveBatchStep,
  runSupabasePublishStep,
} from "@/lib/qeoindex-eod-workflow-steps"

const NOTION_ARCHIVE_BATCH_SIZE = 8
const WYCKOFF_TIMEFRAME_COUNT = 2

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export async function qeoindexEodRetry(input: { runId: string; tickers?: string[] }) {
  "use workflow"

  const context = await loadEodRetryContextStep(input.runId)
  let tickerAttempts = context.tickerAttempts
  const retryTickers = selectRetryTickers(tickerAttempts, input.tickers)
  if (!retryTickers.length) throw new Error(`Run ${input.runId} has no retry-eligible ticker failures`)

  const historyLatest = latestTickerStageAttempts(tickerAttempts, "HISTORY_REFRESH")
  const historyTargets = retryTickers.filter((ticker) => historyLatest.get(ticker)?.status === "failed")
  let residualHistoryFailures = new Set<string>()
  if (historyTargets.length) {
    const historyRetry = await runTargetedHistoryRetryStep(
      context.runId,
      historyTargets,
      context.startedAtIso,
      tickerAttempts,
    )
    tickerAttempts = appendTickerAttempts(tickerAttempts, historyRetry.tickerAttempts)
    residualHistoryFailures = new Set(historyRetry.failedTickers)
  }

  const buildTargets = retryTickers.filter((ticker) => !residualHistoryFailures.has(ticker))
  let buildRetry: Awaited<ReturnType<typeof runTargetedWyckoffRetryStep>> | null = null
  if (buildTargets.length) {
    buildRetry = await runTargetedWyckoffRetryStep(
      context.runId,
      context.canonicalStocks,
      buildTargets,
      context.runKey,
      context.scanDate,
      tickerAttempts,
    )
    tickerAttempts = appendTickerAttempts(tickerAttempts, buildRetry.tickerAttempts)
  }

  const coverage = computeEodTickerCoverage(
    context.canonicalStocks.map((stock) => stock.ticker),
    tickerAttempts,
  )
  if (!coverage.complete) {
    return completeQeoIndexEodPartialStep({
      runId: context.runId,
      runKey: context.runKey,
      scanDate: context.scanDate,
      universeRunId: context.universeRunId,
      coverage,
      tickerAttempts,
      summary: {
        recoveryAttempted: true,
        retryTickers,
        historyTargets,
        residualHistoryFailures: [...residualHistoryFailures].sort(),
        buildTargets,
        expectedSnapshots: context.expectedCount * WYCKOFF_TIMEFRAME_COUNT,
      },
    })
  }

  const validationHash = buildRetry?.validationHash
  if (!validationHash) throw new Error("Targeted retry restored coverage without a deterministic full artifact hash")
  const expectedSnapshots = context.expectedCount * WYCKOFF_TIMEFRAME_COUNT
  const validation = await revalidateFullCanonicalArtifactsStep(
    context.runId,
    context.canonicalStocks,
    context.runKey,
    context.scanDate,
    validationHash,
    context.universeRunId,
  )
  if (validation.snapshotCount !== expectedSnapshots) {
    throw new Error(`SUPABASE_VALIDATE completed ${validation.snapshotCount}/${expectedSnapshots} snapshots after targeted retry`)
  }

  const publish = await runSupabasePublishStep(
    context.runId,
    context.runKey,
    context.scanDate,
    validation.validationHash,
  )
  if (publish.status !== "published" || publish.snapshotCount !== expectedSnapshots) {
    throw new Error(`SUPABASE_PUBLISH incomplete after targeted retry: ${publish.snapshotCount}/${expectedSnapshots}`)
  }

  const deterministic = await runDeterministicCouncilStep(context.runId, true, context.scanDate)

  let marketSynthesis: Awaited<ReturnType<typeof runMarketSynthesisStep>> | {
    ok: false
    status: "failed"
    requestId: null
    ratingDate: string
    error: string
  }
  try {
    marketSynthesis = await runMarketSynthesisStep(context.runId, deterministic.ok, context.scanDate)
  } catch (error) {
    marketSynthesis = {
      ok: false,
      status: "failed",
      requestId: null,
      ratingDate: context.scanDate,
      error: errorMessage(error),
    }
  }

  const llm = await runLlmDebateStep(context.runId, deterministic.ok, context.scanDate)

  const notionUniverseBatches: Array<Awaited<ReturnType<typeof runNotionUniverseArchiveBatchStep>>> = []
  for (let offset = 0; offset < context.canonicalStocks.length; offset += NOTION_ARCHIVE_BATCH_SIZE) {
    notionUniverseBatches.push(await runNotionUniverseArchiveBatchStep(
      context.runId,
      { universeRunId: context.universeRunId },
      context.canonicalStocks.slice(offset, offset + NOTION_ARCHIVE_BATCH_SIZE),
    ))
  }

  const notionEodBatches: Array<Awaited<ReturnType<typeof runNotionEodArchiveBatchStep>>> = []
  for (let offset = 0; offset < context.canonicalStocks.length; offset += NOTION_ARCHIVE_BATCH_SIZE) {
    notionEodBatches.push(await runNotionEodArchiveBatchStep(
      context.runId,
      {
        tradingDate: context.scanDate,
        universeRunId: context.universeRunId,
        validationHash: validation.validationHash,
      },
      context.canonicalStocks.slice(offset, offset + NOTION_ARCHIVE_BATCH_SIZE),
    ))
  }

  const notionArchive = await runNotionArchiveFinalizeStep(context.runId, notionUniverseBatches, notionEodBatches)
  const retention = await runRetentionCleanupStep(context.runId, {
    startedAtIso: context.startedAtIso,
    tradingDate: context.scanDate,
    universeRunId: context.universeRunId,
    universeCount: context.expectedCount,
    expectedSnapshots,
    completedSnapshots: publish.snapshotCount,
    validationHash: validation.validationHash,
    marketSynthesisStatus: marketSynthesis.status,
    notionArchive,
  })

  const complete = await completeRecoveredEodRunStep({
    runId: context.runId,
    runKey: context.runKey,
    scanDate: context.scanDate,
    universeRunId: context.universeRunId,
    expectedCount: context.expectedCount,
    validationHash: validation.validationHash,
    tickerAttempts,
    retryTickers,
    summary: {
      recoveryAttempted: true,
      expectedSnapshots,
      validation,
      publishStatus: publish.status,
      deterministicStatus: deterministic.status,
      marketSynthesisStatus: marketSynthesis.status,
      llmStatus: llm.status,
      notionArchiveStatus: notionArchive.status,
      retentionStatus: retention.status,
    },
  })

  return {
    ok: true as const,
    runId: context.runId,
    status: complete.status,
    retryTickers,
    healthyCount: context.expectedCount,
    failedCount: 0,
    validationHash: validation.validationHash,
    publishStatus: publish.status,
    deterministicStatus: deterministic.status,
    marketSynthesisStatus: marketSynthesis.status,
    llmStatus: llm.status,
    notionArchiveStatus: notionArchive.status,
    retentionStatus: retention.status,
  }
}
