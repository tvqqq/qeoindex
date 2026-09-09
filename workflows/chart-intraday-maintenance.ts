import {
  QEO150_MAINTENANCE_BATCH_SIZE,
  QEO150_MAX_RETRYABLE_ATTEMPTS,
  checkChartIntradayMaintenanceCapacityStep,
  checkChartIntradayMaintenanceExecutionGateStep,
  finishChartIntradayMaintenanceStep,
  recordChartIntradayMaintenanceCapacityStopStep,
  recordChartIntradayMaintenanceFailureStopStep,
  runChartIntradayMaintenanceTickerStep,
  startChartIntradayMaintenanceStep,
  type Qeo150MaintenanceSummary,
  type Qeo150MaintenanceTickerResult,
} from "@/modules/market/chart-data/maintenance-workflow-steps"

export async function chartIntradayMaintenanceWorkflow(
  startedAtIso: string,
  dispatchId: string,
): Promise<Qeo150MaintenanceSummary> {
  "use workflow"

  const context = await startChartIntradayMaintenanceStep(startedAtIso, dispatchId)
  const resultByTicker = new Map<string, Qeo150MaintenanceTickerResult>()

  maintenance: for (let offset = 0; offset < context.stocks.length; offset += QEO150_MAINTENANCE_BATCH_SIZE) {
    const executionGate = await checkChartIntradayMaintenanceExecutionGateStep({ slaDeadline: context.slaDeadline })
    if (executionGate.deadlineExceeded) {
      const remaining = context.stocks
        .slice(offset)
        .map((stock) => stock.ticker)
        .filter((ticker) => !resultByTicker.has(ticker))
      const reason = `QEO-150 sla_timeout: reconciliation exceeded SLA deadline ${context.slaDeadline}`
      const stopped = await recordChartIntradayMaintenanceFailureStopStep({
        tickers: remaining,
        expectedSession: context.expectedSession,
        dispatchId: context.dispatchId,
        referenceAt: context.startedAt,
        reason,
      })
      for (const result of stopped) resultByTicker.set(result.ticker, result)
      break
    }

    const batch = context.stocks.slice(offset, offset + QEO150_MAINTENANCE_BATCH_SIZE)
    const capacityGate = offset === 0
      ? {
          allowed: context.initialCapacity.level !== "HARD_STOP",
          capacity: context.initialCapacity,
          reason: context.initialCapacity.level === "HARD_STOP"
            ? `QEO-150 capacity hard-stop at ${context.initialCapacity.databaseBytes} bytes; maintenance will not fetch or write more 1m data.`
            : null,
        }
      : await checkChartIntradayMaintenanceCapacityStep()

    if (!capacityGate.allowed) {
      const remaining = context.stocks.slice(offset).map((stock) => stock.ticker)
      const stopped = await recordChartIntradayMaintenanceCapacityStopStep({
        tickers: remaining,
        expectedSession: context.expectedSession,
        dispatchId: context.dispatchId,
        referenceAt: context.startedAt,
        reason: capacityGate.reason ?? "QEO-150 capacity hard-stop",
      })
      for (const result of stopped) resultByTicker.set(result.ticker, result)
      break
    }

    let pending = batch.map((stock) => stock.ticker)
    for (let attempt = 1; attempt <= QEO150_MAX_RETRYABLE_ATTEMPTS && pending.length; attempt += 1) {
      const retryGate = await checkChartIntradayMaintenanceExecutionGateStep({ slaDeadline: context.slaDeadline })
      if (retryGate.deadlineExceeded) {
        const remaining = context.stocks
          .slice(offset)
          .map((stock) => stock.ticker)
          .filter((ticker) => !resultByTicker.has(ticker))
        const reason = `QEO-150 sla_timeout: reconciliation exceeded SLA deadline ${context.slaDeadline}`
        const stopped = await recordChartIntradayMaintenanceFailureStopStep({
          tickers: remaining,
          expectedSession: context.expectedSession,
          dispatchId: context.dispatchId,
          referenceAt: context.startedAt,
          reason,
        })
        for (const result of stopped) resultByTicker.set(result.ticker, result)
        break maintenance
      }

      const attemptResults = await Promise.all(pending.map((ticker) => runChartIntradayMaintenanceTickerStep({
        ticker,
        expectedSession: context.expectedSession,
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

  return finishChartIntradayMaintenanceStep({
    context,
    results: context.stocks
      .map((stock) => resultByTicker.get(stock.ticker))
      .filter((result): result is Qeo150MaintenanceTickerResult => Boolean(result)),
  })
}
