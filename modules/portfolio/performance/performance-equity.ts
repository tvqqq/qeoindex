import type { EquityPoint } from "../risk-engine/types.ts"

export function performanceEquityVnd(point: EquityPoint): number | null {
  if (point.status !== "complete") return null
  if (point.fundingHistoryStatus === "legacy_unrecorded") return null
  const value = point.flowAdjustedEquityVnd ?? point.equityVnd
  return value != null && Number.isFinite(value) ? value : null
}

export function hasCompletePerformanceEquity(point: EquityPoint): boolean {
  return performanceEquityVnd(point) != null
}
