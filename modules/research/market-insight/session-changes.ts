export type ForeignFlowReversal = "to_inflow" | "to_outflow" | null

export interface MarketSessionNumericChange {
  current: number | null
  previous: number | null
  delta: number | null
}

export interface MarketSessionLiquidityChange extends MarketSessionNumericChange {
  deltaPct: number | null
}

export interface MarketSessionChanges {
  previousSessionDate: string | null
  sentiment: MarketSessionNumericChange
  risk: MarketSessionNumericChange
  ma20Breadth: MarketSessionNumericChange
  ma50Breadth: MarketSessionNumericChange
  liquidity: MarketSessionLiquidityChange
  regime: {
    current: string | null
    previous: string | null
    changed: boolean
  }
  foreignFlowReversal: ForeignFlowReversal
}

interface MarketSessionChangeInput {
  sessionDate: string
  marketRegime?: string | null
  dailySummary: {
    sentimentScore?: number | null
    sentimentHistory?: Array<{ tradingDate: string; value: number }>
    riskScore?: number | null
    aboveMa20Pct?: number | null
    aboveMa50Pct?: number | null
    foreignNetValue?: number | null
    totalTradedValue?: number | null
  }
  history?: Array<{
    sessionDate: string
    marketRegime?: string | null
    riskScore?: number | null
    aboveMa20Pct?: number | null
    aboveMa50Pct?: number | null
    foreignNetValue?: number | null
    totalTradedValue?: number | null
  }>
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function rounded(value: number, decimals = 6) {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function numericChange(currentValue: number | null | undefined, previousValue: number | null | undefined): MarketSessionNumericChange {
  const current = finite(currentValue)
  const previous = finite(previousValue)
  return {
    current,
    previous,
    delta: current != null && previous != null ? rounded(current - previous) : null,
  }
}

export function buildMarketSessionChanges(input: MarketSessionChangeInput): MarketSessionChanges {
  const previousSession = [...(input.history ?? [])]
    .filter((point) => point.sessionDate < input.sessionDate)
    .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate))[0] ?? null

  const previousSentiment = [...(input.dailySummary.sentimentHistory ?? [])]
    .filter((point) => point.tradingDate < input.sessionDate && Number.isFinite(point.value))
    .sort((left, right) => right.tradingDate.localeCompare(left.tradingDate))[0]?.value ?? null

  const sentiment = numericChange(input.dailySummary.sentimentScore, previousSentiment)
  const risk = numericChange(input.dailySummary.riskScore, previousSession?.riskScore)
  const ma20Breadth = numericChange(input.dailySummary.aboveMa20Pct, previousSession?.aboveMa20Pct)
  const ma50Breadth = numericChange(input.dailySummary.aboveMa50Pct, previousSession?.aboveMa50Pct)
  const liquidityBase = numericChange(input.dailySummary.totalTradedValue, previousSession?.totalTradedValue)
  const liquidity: MarketSessionLiquidityChange = {
    ...liquidityBase,
    deltaPct: liquidityBase.current != null && liquidityBase.previous != null && liquidityBase.previous !== 0
      ? rounded(((liquidityBase.current - liquidityBase.previous) / Math.abs(liquidityBase.previous)) * 100)
      : null,
  }

  const currentForeign = finite(input.dailySummary.foreignNetValue)
  const previousForeign = finite(previousSession?.foreignNetValue)
  const foreignFlowReversal: ForeignFlowReversal =
    currentForeign != null && previousForeign != null && previousForeign > 0 && currentForeign < 0
      ? "to_outflow"
      : currentForeign != null && previousForeign != null && previousForeign < 0 && currentForeign > 0
        ? "to_inflow"
        : null

  const currentRegime = input.marketRegime ?? null
  const previousRegime = previousSession?.marketRegime ?? null

  return {
    previousSessionDate: previousSession?.sessionDate ?? null,
    sentiment,
    risk,
    ma20Breadth,
    ma50Breadth,
    liquidity,
    regime: {
      current: currentRegime,
      previous: previousRegime,
      changed: currentRegime != null && previousRegime != null && currentRegime !== previousRegime,
    },
    foreignFlowReversal,
  }
}
