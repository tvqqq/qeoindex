import { buildTradingScorecard } from "./scorecard.ts"
import type {
  ClosedTradeOutcome,
  PerformancePopulation,
  PerformanceSegment,
} from "./types.ts"

type SegmentDimension = PerformanceSegment["dimension"]

function selectedOutcomes(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): ClosedTradeOutcome[] {
  return population === "combined"
    ? [...outcomes]
    : outcomes.filter((row) => row.mode === population)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function memberships(row: ClosedTradeOutcome): Array<{ dimension: SegmentDimension; key: string }> {
  return [
    ...unique(row.systemTags).map((key) => ({ dimension: "system" as const, key })),
    ...unique(row.setupTags).map((key) => ({ dimension: "setup" as const, key })),
    ...(row.timeframe?.trim() ? [{ dimension: "timeframe" as const, key: row.timeframe.trim() }] : []),
    { dimension: "mode" as const, key: row.mode },
    ...unique(row.behaviorTags).map((key) => ({ dimension: "behavior" as const, key })),
    ...unique(row.mistakeTags).map((key) => ({ dimension: "mistake" as const, key })),
  ]
}

export function buildPerformanceSegments(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): PerformanceSegment[] {
  const selected = selectedOutcomes(outcomes, population)
  const groups = new Map<string, { dimension: SegmentDimension; key: string; rows: ClosedTradeOutcome[] }>()

  for (const row of selected) {
    for (const membership of memberships(row)) {
      const groupKey = `${membership.dimension}\u0000${membership.key}`
      const existing = groups.get(groupKey)
      if (existing) {
        existing.rows.push(row)
      } else {
        groups.set(groupKey, { ...membership, rows: [row] })
      }
    }
  }

  return [...groups.values()]
    .map((group) => {
      const card = buildTradingScorecard({
        outcomes: group.rows,
        population: "combined",
        initialCapitalVnd: null,
      })
      return {
        dimension: group.dimension,
        key: group.key,
        sampleSize: card.eligibleTradeCount,
        winRatioPercent: card.winRatioPercent.value,
        payoffRatio: card.payoffRatio.value,
        netPnlVnd: card.netPnlVnd,
        smallSample: card.eligibleTradeCount < 5,
      }
    })
    .sort((a, b) => {
      const dimensionDiff = a.dimension.localeCompare(b.dimension)
      return dimensionDiff !== 0 ? dimensionDiff : a.key.localeCompare(b.key)
    })
}
