import type { EquityPoint } from "../risk-engine/types.ts"
import type { DrawdownAnalytics, DrawdownEpisode } from "./types.ts"

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function deriveDrawdownAnalytics(
  points: readonly EquityPoint[],
): DrawdownAnalytics {
  if (
    points.length === 0
    || points.some((point) => (
      point.status !== "complete"
      || point.equityVnd == null
      || !Number.isFinite(point.equityVnd)
    ))
  ) {
    return {
      maxDrawdownPercent: null,
      averageDrawdownPercent: null,
      episodes: [],
      completeness: "insufficient",
    }
  }

  let peakKey = points[0]!.key
  let peakEquityVnd = points[0]!.equityVnd!
  let active: DrawdownEpisode | null = null
  const episodes: DrawdownEpisode[] = []

  for (const point of points.slice(1)) {
    const equityVnd = point.equityVnd!

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
