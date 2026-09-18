import type { ChartTimeframe } from "./stock-chart-types"

export function chartHistoryIdentity(ticker: string, timeframe: ChartTimeframe): string {
  return `${ticker.trim().toUpperCase()}:${timeframe}`
}

/**
 * React state updates from a history reset land in a layout effect. Until that
 * effect runs, render the target family's prepared/seed bars instead of the
 * previous family's state. This keeps chart consumers identity-safe during a
 * synchronous ticker or timeframe transition.
 */
export function renderBarsForChartIdentity<T>(
  currentKey: string,
  requestedKey: string,
  currentBars: T[],
  targetBars: T[],
): T[] {
  return currentKey === requestedKey ? currentBars : targetBars
}
