import {
  QEO107_BOOTSTRAP_BATCH_SIZE,
  checkChartIntradayBootstrapCapacityStep,
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
  const chunk = context.target.chunks[0]
  let attemptedChunks = 0
  let succeededChunks = 0
  let skippedChunks = 0
  let providerGapChunks = 0
  let retryableFailureChunks = 0
  let failedChunks = 0
  let consecutiveRetryableFailures = 0
  let consecutivePermanentFailures = 0
  let capacityWarningCheckpoints = context.initialCapacity.warning ? 1 : 0
  let stopReason: string | null = null
  let capacityGate = context.initialCapacity

  outer: for (let offset = 0; offset < context.stocks.length; offset += QEO107_BOOTSTRAP_BATCH_SIZE) {
    const batch = context.stocks.slice(offset, offset + QEO107_BOOTSTRAP_BATCH_SIZE)
    if (!capacityGate.allowed) {
      stopReason = capacityGate.reason ?? "QEO-107 capacity hard-stop"
      break
    }

    for (const stock of batch) {
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

    const nextOffset = offset + QEO107_BOOTSTRAP_BATCH_SIZE
    if (nextOffset < context.stocks.length) {
      const upcomingTickers = Math.min(QEO107_BOOTSTRAP_BATCH_SIZE, context.stocks.length - nextOffset)
      capacityGate = await checkChartIntradayBootstrapCapacityStep({ upcomingTickers })
      if (capacityGate.warning) capacityWarningCheckpoints += 1
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
    capacityWarningCheckpoints,
  })
}
