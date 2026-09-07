export type OptimalFResult = {
  value: number | null
  status: "available" | "insufficient_history" | "invalid"
}

export function calculateOptimalF(
  winRatioPercent: number | null,
  payoffRatio: number | null,
): OptimalFResult {
  if (winRatioPercent == null || payoffRatio == null) {
    return { value: null, status: "insufficient_history" }
  }
  if (
    !Number.isFinite(winRatioPercent)
    || winRatioPercent < 0
    || winRatioPercent > 100
    || !Number.isFinite(payoffRatio)
    || payoffRatio <= 0
  ) {
    return { value: null, status: "invalid" }
  }

  const p = winRatioPercent / 100
  const value = (((payoffRatio + 1) * p) - 1) / payoffRatio
  return Number.isFinite(value)
    ? { value, status: "available" }
    : { value: null, status: "invalid" }
}
