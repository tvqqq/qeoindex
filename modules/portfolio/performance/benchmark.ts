import type { EquityPoint } from "../risk-engine/types.ts"
import type {
  BenchmarkComparison,
  BenchmarkIndexPoint,
  BenchmarkPoint,
} from "./types.ts"

function unavailable(reason: string): BenchmarkComparison {
  return {
    points: [],
    portfolioReturnPercent: null,
    vnindexReturnPercent: null,
    alphaPercent: null,
    completeness: "insufficient",
    reason,
  }
}

function normalizePercent(value: number): number {
  return Number(value.toFixed(10))
}

function validDailyEquity(points: readonly EquityPoint[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const point of points) {
    if (point.kind !== "daily" || point.status !== "complete") continue
    if (point.equityVnd == null || !Number.isFinite(point.equityVnd) || point.equityVnd <= 0) continue
    result.set(point.key.slice(0, 10), point.equityVnd)
  }
  return result
}

function validIndex(points: readonly BenchmarkIndexPoint[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const point of points) {
    if (!Number.isFinite(point.close) || point.close <= 0) continue
    result.set(point.date.slice(0, 10), point.close)
  }
  return result
}

export function buildBenchmarkComparison({
  equityPoints,
  vnindexPoints,
}: {
  equityPoints: readonly EquityPoint[]
  vnindexPoints: readonly BenchmarkIndexPoint[]
}): BenchmarkComparison {
  const equityByDate = validDailyEquity(equityPoints)
  const indexByDate = validIndex(vnindexPoints)
  const commonDates = [...equityByDate.keys()]
    .filter((date) => indexByDate.has(date))
    .sort((a, b) => a.localeCompare(b))

  const firstDate = commonDates[0]
  if (!firstDate) return unavailable("No common complete daily date exists between Account Equity and VNINDEX.")

  const portfolioBaseline = equityByDate.get(firstDate)
  const indexBaseline = indexByDate.get(firstDate)
  if (portfolioBaseline == null || indexBaseline == null || portfolioBaseline <= 0 || indexBaseline <= 0) {
    return unavailable("Benchmark baselines must be positive and complete on the first common date.")
  }

  const points: BenchmarkPoint[] = commonDates.map((date) => {
    const equity = equityByDate.get(date)!
    const index = indexByDate.get(date)!
    const portfolioReturnPercent = normalizePercent(((equity / portfolioBaseline) - 1) * 100)
    const vnindexReturnPercent = normalizePercent(((index / indexBaseline) - 1) * 100)
    return {
      date,
      portfolioReturnPercent,
      vnindexReturnPercent,
      alphaPercent: normalizePercent(portfolioReturnPercent - vnindexReturnPercent),
    }
  })

  const latest = points.at(-1)
  if (!latest) return unavailable("No common complete benchmark points are available.")

  return {
    points,
    portfolioReturnPercent: latest.portfolioReturnPercent,
    vnindexReturnPercent: latest.vnindexReturnPercent,
    alphaPercent: latest.alphaPercent,
    completeness: "complete",
    reason: null,
  }
}
