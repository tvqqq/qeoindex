import {
  QEO180_CATCHUP_BATCH_SIZE,
  QEO180_MAX_RETRYABLE_ATTEMPTS,
  checkChartIntradayHotContinuityCapacityStep,
  finishChartIntradayHotContinuityStep,
  runChartIntradayHotContinuityRangeStep,
  startChartIntradayHotContinuityStep,
  type Qeo180CatchupResult,
  type Qeo180HotContinuitySummary,
  type Qeo180MissingHotSession,
} from "@/modules/market/chart-data/hot-continuity-workflow-steps"

function rangeKey(range: Qeo180MissingHotSession) {
  return `${range.ticker}:${range.sessionDate}`
}

export async function chartIntradayHotContinuityWorkflow(
  startedAtIso: string,
  dispatchId: string,
): Promise<Qeo180HotContinuitySummary> {
  "use workflow"

  const context = await startChartIntradayHotContinuityStep(startedAtIso, dispatchId)
  const resultByRange = new Map<string, Qeo180CatchupResult>()
  let capacityStopped = false

  for (let offset = 0; offset < context.missingHotSessions.length; offset += QEO180_CATCHUP_BATCH_SIZE) {
    const capacityGate = offset === 0
      ? { allowed: context.initialCapacity.level !== "HARD_STOP" }
      : await checkChartIntradayHotContinuityCapacityStep()
    if (!capacityGate.allowed) {
      capacityStopped = true
      break
    }

    let pending = context.missingHotSessions.slice(offset, offset + QEO180_CATCHUP_BATCH_SIZE)
    for (let attempt = 1; attempt <= QEO180_MAX_RETRYABLE_ATTEMPTS && pending.length; attempt += 1) {
      const attemptResults = await Promise.all(pending.map((range) => runChartIntradayHotContinuityRangeStep({
        range,
        referenceAt: context.startedAt,
        attempt,
      })))
      const retry: Qeo180MissingHotSession[] = []
      for (const result of attemptResults) {
        if (result.outcome === "retryable_failure" && attempt < QEO180_MAX_RETRYABLE_ATTEMPTS) {
          retry.push(result)
        } else {
          resultByRange.set(rangeKey(result), result)
        }
      }
      pending = retry
    }
  }

  return finishChartIntradayHotContinuityStep({
    context,
    results: context.missingHotSessions
      .map((range) => resultByRange.get(rangeKey(range)))
      .filter((result): result is Qeo180CatchupResult => Boolean(result)),
    capacityStopped,
  })
}
