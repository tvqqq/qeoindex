import type { EquityPoint } from "../risk-engine/types.ts"
import { performanceEquityVnd } from "./performance-equity.ts"
import type { DrawdownAnalytics, DrawdownEpisode } from "./types.ts"

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function deriveDrawdownAnalytics(
  points: readonly EquityPoint[],
): DrawdownAnalytics {
  const performanceValues = points.map(performanceEquityVnd)
  if (points.length === 0 || performanceValues.some((value) => value == null)) {
    return {
      maxDrawdownPercent: null,
      averageDrawdownPercent: null,
      episodes: [],
      completeness: "insufficient",
    }
  }

  let peakKey = points[0]!.key
  let peakEquityVnd = performanceValues[0]!
  let active: DrawdownEpisode | null = null
  const episodes: DrawdownEpisode[] = []

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!
    const equityVnd = performanceValues[index]!

    if (active == null) {
      if (equityVnd >= peakEquityVnd) {
        peakKey = point.key
        peakEquityVnd = equityVnd
        continue
      }

      active = {
        peakKey,
        startKey: point.key,
        troughKey: point.key,
        recoveryKey: null,
        peakEquityVnd,
        troughEquityVnd: equityVnd,
        depthPercent: ((peakEquityVnd - equityVnd) / peakEquityVnd) * 100,
        recovered: false,
      }
      continue
    }

    if (equityVnd >= active.peakEquityVnd) {
      active.recoveryKey = point.key
      active.recovered = true
      episodes.push(active)
      active = null
      peakKey = point.key
      peakEquityVnd = equityVnd
      continue
    }

    if (equityVnd < active.troughEquityVnd) {
      active.troughKey = point.key
      active.troughEquityVnd = equityVnd
      active.depthPercent = (
        (active.peakEquityVnd - equityVnd) / active.peakEquityVnd
      ) * 100
    }
  }

  if (active != null) episodes.push(active)

  return {
    maxDrawdownPercent: episodes.length > 0
      ? Math.max(...episodes.map((episode) => episode.depthPercent))
      : 0,
    averageDrawdownPercent: episodes.length > 0
      ? average(episodes.map((episode) => episode.depthPercent))
      : null,
    episodes,
    completeness: "complete",
  }
}
