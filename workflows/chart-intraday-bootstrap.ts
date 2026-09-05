import {
  finishChartIntradayBootstrapStep,
  runChartIntradayBootstrapTickerStep,
  startChartIntradayBootstrapStep,
  type Qeo107BootstrapWorkflowSummary,
} from "@/modules/market/chart-data/bootstrap-workflow-steps"

const MAX_CONSECUTIVE_RETRYABLE_FAILURES = 5
const MAX_CONSECUTIVE_PERMANENT_FAILURES = 3

export async function chartIntradayBootstrapWorkflow(startedAtIso: string): Promise<Qeo107BootstrapWorkflowSummary> {
  "use workflow"

  const context = await startChartIntradayBootstrapStep(startedAtIso)
  let attemptedChunks = 0
  let succeededChunks = 0
  let skippedChunks = 0
  let providerGapChunks = 0
  let retryableFailureChunks = 0
  let failedChunks = 0
  let consecutiveRetryableFailures = 0
  let consecutivePermanentFailures = 0
  let stopReason: string | null = null

  outer: for (const chunk of context.target.chunks) {
    for (const stock of context.stocks) {
      const result = await runChartIntradayBootstrapTickerStep({
        ticker: stock.ticker,
        chunk,
        referenceAt: context.startedAt,
      })
      attemptedChunks += 1

      if (result.status === "succeeded") {
        succeededChunks += 1
        consecutiveRetryableFailures = 0
        consecutivePermanentFailures = 0
        continue
      }
      if (result.status === "skipped") {
        skippedChunks += 1
        consecutiveRetryableFailures = 0
        consecutivePermanentFailures = 0
        continue
      }
      if (result.status === "provider_gap") {
        providerGapChunks += 1
        consecutiveRetryableFailures = 0
        consecutivePermanentFailures = 0
        continue
      }
      if (result.status === "retryable_failure") {
        retryableFailureChunks += 1
        consecutiveRetryableFailures += 1
        consecutivePermanentFailures = 0
        if (consecutiveRetryableFailures >= MAX_CONSECUTIVE_RETRYABLE_FAILURES) {
          stopReason = `Stopped after ${consecutiveRetryableFailures} consecutive retryable provider failures; rerun resumes from provenance.`
          break outer
        }
        continue
      }

      failedChunks += 1
      consecutivePermanentFailures += 1
      consecutiveRetryableFailures = 0
      if (consecutivePermanentFailures >= MAX_CONSECUTIVE_PERMANENT_FAILURES) {
        stopReason = `Stopped after ${consecutivePermanentFailures} consecutive permanent provider failures; fix provider/auth configuration before rerun.`
        break outer
      }
    }
  }

  return finishChartIntradayBootstrapStep({
    context,
    stoppedEarly: stopReason !== null,
    stopReason,
    attemptedChunks,
    succeededChunks,
    skippedChunks,
    providerGapChunks,
    retryableFailureChunks,
    failedChunks,
  })
}
