import {
  QEO150_MAINTENANCE_BATCH_SIZE,
  QEO150_MAX_RETRYABLE_ATTEMPTS,
  checkChartIntradayMaintenanceCapacityStep,
  recordChartIntradayMaintenanceCapacityStopStep,
  runChartIntradayMaintenanceTickerStep,
  type Qeo150MaintenanceTickerResult,
} from "@/modules/market/chart-data/maintenance-workflow-steps"
import {
  finishChartIntradayMaintenanceRecoveryStep,
  startChartIntradayMaintenanceRecoveryStep,
  type Qeo150MaintenanceRecoverySummary,
} from "@/modules/market/chart-data/maintenance-recovery-workflow-steps"

export async function chartIntradayMaintenanceRecoveryWorkflow(
  startedAtIso: string,
  dispatchId: string,
  sessionDate: string,
  tickers: string[],
): Promise<Qeo150MaintenanceRecoverySummary> {
  "use workflow"

  const context = await startChartIntradayMaintenanceRecoveryStep({
    startedAtIso,
    dispatchId,
    sessionDate,
    tickers,
  })
  const resultByTicker = new Map<string, Qeo150MaintenanceTickerResult>()

  for (let offset = 0; offset < context.stocks.length; offset += QEO150_MAINTENANCE_BATCH_SIZE) {
    const batch = context.stocks.slice(offset, offset + QEO150_MAINTENANCE_BATCH_SIZE)
    let pending = batch.map((stock) => stock.ticker)

    for (let attempt = 1; attempt <= QEO150_MAX_RETRYABLE_ATTEMPTS && pending.length; attempt += 1) {
      const capacityGate = offset === 0 && attempt === 1
        ? {
            allowed: context.initialCapacity.level !== "HARD_STOP",
            capacity: context.initialCapacity,
            reason: context.initialCapacity.level === "HARD_STOP"
              ? `QEO-150 recovery capacity hard-stop at ${context.initialCapacity.databaseBytes} bytes.`
              : null,
          }
        : await checkChartIntradayMaintenanceCapacityStep()

      if (!capacityGate.allowed) {
        const stopped = await recordChartIntradayMaintenanceCapacityStopStep({
          tickers: pending,
          expectedSession: context.sessionDate,
          dispatchId: context.dispatchId,
          referenceAt: context.startedAt,
          reason: capacityGate.reason ?? "QEO-150 recovery capacity hard-stop",
        })
        for (const result of stopped) resultByTicker.set(result.ticker, result)
        break
      }

      const attemptResults = await Promise.all(pending.map((ticker) => runChartIntradayMaintenanceTickerStep({
        ticker,
        expectedSession: context.sessionDate,
        dispatchId: context.dispatchId,
        referenceAt: context.startedAt,
        attempt,
      })))
      const retry: string[] = []
      for (const result of attemptResults) {
        if (result.outcome === "retryable_failure" && attempt < QEO150_MAX_RETRYABLE_ATTEMPTS) {
          retry.push(result.ticker)
        } else {
          resultByTicker.set(result.ticker, result)
        }
      }
      pending = retry
    }
  }

  return finishChartIntradayMaintenanceRecoveryStep({
    context,
    results: context.stocks
      .map((stock) => resultByTicker.get(stock.ticker))
      .filter((result): result is Qeo150MaintenanceTickerResult => Boolean(result)),
  })
}
