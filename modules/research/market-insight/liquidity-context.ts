export type LiquidityConfirmationState = "confirmed" | "weak" | "unknown"

export interface LiquidityContext {
  current: number | null
  historyCount: number
  ma20: number | null
  vsMa20Pct: number | null
  percentile60: number | null
  state: LiquidityConfirmationState
}

interface LiquidityContextInput {
  sessionDate: string
  currentValue: number | null | undefined
  history?: Array<{
    sessionDate: string
    totalTradedValue?: number | null
  }>
}

function validLiquidity(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function rounded(value: number, decimals = 6) {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function buildLiquidityContext(input: LiquidityContextInput): LiquidityContext {
  const current = validLiquidity(input.currentValue)
  const prior = [...(input.history ?? [])]
    .filter((point) => point.sessionDate < input.sessionDate)
    .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate))
    .flatMap((point) => {
      const value = validLiquidity(point.totalTradedValue)
      return value == null ? [] : [value]
    })
    .slice(0, 60)

  if (current == null || prior.length < 20) {
    return {
      current,
      historyCount: prior.length,
      ma20: null,
      vsMa20Pct: null,
      percentile60: null,
      state: "unknown",
    }
  }

  const ma20Values = prior.slice(0, 20)
  const ma20 = rounded(ma20Values.reduce((sum, value) => sum + value, 0) / ma20Values.length)
  const vsMa20Pct = ma20 !== 0 ? rounded(((current - ma20) / ma20) * 100) : null
  const percentile60 = rounded((prior.filter((value) => value <= current).length / prior.length) * 100)

  const state: LiquidityConfirmationState =
    vsMa20Pct != null && vsMa20Pct >= 0 && percentile60 >= 60
      ? "confirmed"
      : vsMa20Pct != null && vsMa20Pct < 0 && percentile60 <= 40
        ? "weak"
        : "unknown"

  return {
    current,
    historyCount: prior.length,
    ma20,
    vsMa20Pct,
    percentile60,
    state,
  }
}
