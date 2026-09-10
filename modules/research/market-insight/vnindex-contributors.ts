export type VnindexContributionDirection = "up" | "down" | "unknown"
export type VnindexConcentrationState = "high" | "normal" | "unknown"

export interface VnindexLeaderImpactInput {
  category: string
  ticker: string
  estimatedIndexPoints: number | null
  rank?: number
}

export interface VnindexContributorsContext<T extends VnindexLeaderImpactInput = VnindexLeaderImpactInput> {
  direction: VnindexContributionDirection
  pullers: T[]
  draggers: T[]
  top5ContributionPct: number | null
  top10ContributionPct: number | null
  concentrationState: VnindexConcentrationState
}

function round6(value: number) {
  return Number(value.toFixed(6))
}

function isFiniteImpact(value: number | null): value is number {
  return value != null && Number.isFinite(value)
}

function contributionPct<T extends VnindexLeaderImpactInput>(items: T[], count: number, denominator: number) {
  const grossPoints = items
    .slice(0, count)
    .reduce((sum, item) => sum + Math.abs(item.estimatedIndexPoints ?? 0), 0)
  return round6(grossPoints / Math.abs(denominator) * 100)
}

export function buildVnindexContributorsContext<T extends VnindexLeaderImpactInput>({
  vnindexChange,
  leaders,
}: {
  vnindexChange: number | null
  leaders: readonly T[]
}): VnindexContributorsContext<T> {
  const pullers = leaders
    .filter((item): item is T => item.category === "index_up" && isFiniteImpact(item.estimatedIndexPoints) && item.estimatedIndexPoints > 0)
    .sort((left, right) => (right.estimatedIndexPoints ?? 0) - (left.estimatedIndexPoints ?? 0))
    .slice(0, 10)

  const draggers = leaders
    .filter((item): item is T => item.category === "index_down" && isFiniteImpact(item.estimatedIndexPoints) && item.estimatedIndexPoints < 0)
    .sort((left, right) => (left.estimatedIndexPoints ?? 0) - (right.estimatedIndexPoints ?? 0))
    .slice(0, 10)

  const direction: VnindexContributionDirection = vnindexChange != null && Number.isFinite(vnindexChange) && vnindexChange !== 0
    ? vnindexChange > 0 ? "up" : "down"
    : "unknown"

  if (direction === "unknown" || vnindexChange == null) {
    return {
      direction,
      pullers,
      draggers,
      top5ContributionPct: null,
      top10ContributionPct: null,
      concentrationState: "unknown",
    }
  }

  const directionalLeaders = direction === "up" ? pullers : draggers
  const top5ContributionPct = contributionPct(directionalLeaders, 5, vnindexChange)
  const top10ContributionPct = contributionPct(directionalLeaders, 10, vnindexChange)

  return {
    direction,
    pullers,
    draggers,
    top5ContributionPct,
    top10ContributionPct,
    concentrationState: top5ContributionPct >= 60 ? "high" : "normal",
  }
}
