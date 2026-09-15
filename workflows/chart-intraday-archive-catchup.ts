import {
  QEO228_ARCHIVE_BATCH_SIZE,
  finishChartIntradayArchiveCatchupStep,
  runChartIntradayArchiveTickerStep,
  startChartIntradayArchiveCatchupStep,
  type Qeo228ArchiveTickerResult,
  type Qeo228ArchiveCatchupSummary,
} from "@/modules/market/chart-data/archive-catchup-workflow-steps"

export async function chartIntradayArchiveCatchupWorkflow(
  startedAtIso: string,
  dispatchId: string,
): Promise<Qeo228ArchiveCatchupSummary> {
  "use workflow"

  const context = await startChartIntradayArchiveCatchupStep(startedAtIso, dispatchId)
  const results: Qeo228ArchiveTickerResult[] = []

  for (let offset = 0; offset < context.tickers.length; offset += QEO228_ARCHIVE_BATCH_SIZE) {
    const batch = context.tickers.slice(offset, offset + QEO228_ARCHIVE_BATCH_SIZE)
    const batchResults = await Promise.all(batch.map((ticker) => runChartIntradayArchiveTickerStep({
      ticker,
      referenceAt: context.startedAt,
    })))
    results.push(...batchResults)
  }

  const summary = await finishChartIntradayArchiveCatchupStep({ context, results })
  if (summary.results.some((item) => item.status === "failed" || item.status === "partial")) {
    return { ...summary, status: "partial" }
  }
  return summary
}
