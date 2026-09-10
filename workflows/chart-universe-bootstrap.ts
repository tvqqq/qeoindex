import {
  QEO105_BOOTSTRAP_BATCH_SIZE,
  QEO105_MAX_RETRYABLE_ATTEMPTS,
  finishChartUniverseBootstrapStep,
  runChartUniverseDailyBootstrapStep,
  runChartUniverseIntradayBootstrapStep,
  startChartUniverseBootstrapStep,
  type Qeo105TickerState,
  type Qeo105UniverseBootstrapSummary,
} from "@/modules/market/chart-data/universe-bootstrap-workflow-steps"

export async function chartUniverseBootstrapWorkflow(
  transitionId: string,
  startedAtIso: string,
  dispatchId: string,
): Promise<Qeo105UniverseBootstrapSummary> {
  "use workflow"

  const context = await startChartUniverseBootstrapStep(transitionId, startedAtIso, dispatchId)
  if (!context.claimed) return finishChartUniverseBootstrapStep({ context })

  const stateByTicker = new Map<string, Qeo105TickerState>(context.tickers.map((ticker) => [ticker.ticker, { ...ticker }]))

  for (let offset = 0; offset < context.addedTickers.length; offset += QEO105_BOOTSTRAP_BATCH_SIZE) {
    const batch = context.addedTickers.slice(offset, offset + QEO105_BOOTSTRAP_BATCH_SIZE)

    let pendingDaily = batch.filter((ticker) => stateByTicker.get(ticker)?.dailyStatus !== "ready")
    for (let attempt = 1; attempt <= QEO105_MAX_RETRYABLE_ATTEMPTS && pendingDaily.length; attempt += 1) {
      const results = await Promise.all(pendingDaily.map((ticker) => {
        const state = stateByTicker.get(ticker)!
        return runChartUniverseDailyBootstrapStep({
          transitionId: context.transitionId,
          ticker,
          dailyStatus: state.dailyStatus,
          intradayStatus: state.intradayStatus,
          referenceAt: context.startedAt,
        })
      }))
      const retry: string[] = []
      for (const result of results) {
        const state = stateByTicker.get(result.ticker)!
        if (result.status === "ready") {
          state.dailyStatus = "ready"
          state.dailyRows = result.dailyRows
          state.dailyLastBarTime = result.dailyLastBarTime
          state.lastError = null
        } else {
          state.dailyStatus = result.status
          state.status = result.status
          state.lastError = result.error
          if (result.status === "retryable" && attempt < QEO105_MAX_RETRYABLE_ATTEMPTS) retry.push(result.ticker)
        }
      }
      pendingDaily = retry
    }

    let pendingIntraday = batch.filter((ticker) => {
      const state = stateByTicker.get(ticker)!
      return state.dailyStatus === "ready" && state.intradayStatus !== "ready"
    })
    for (let attempt = 1; attempt <= QEO105_MAX_RETRYABLE_ATTEMPTS && pendingIntraday.length; attempt += 1) {
      const results = await Promise.all(pendingIntraday.map((ticker) => {
        const state = stateByTicker.get(ticker)!
        return runChartUniverseIntradayBootstrapStep({
          transitionId: context.transitionId,
          ticker,
          intradayStatus: state.intradayStatus,
          referenceAt: context.startedAt,
        })
      }))
      const retry: string[] = []
      for (const result of results) {
        const state = stateByTicker.get(result.ticker)!
        state.intradayStatus = result.status
        state.intradayHotSessions = result.hotSessionCount
        state.lastError = result.error
        if (result.status === "ready") {
          state.status = "ready"
          state.lastError = null
        } else {
          state.status = result.status
          if (result.status === "retryable" && attempt < QEO105_MAX_RETRYABLE_ATTEMPTS) retry.push(result.ticker)
        }
      }
      pendingIntraday = retry
    }
  }

  return finishChartUniverseBootstrapStep({ context })
}
