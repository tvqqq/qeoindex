import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

type ValuationHistoryPoint = {
  tradingDate: string
  pe: number | null
  pb: number | null
}

function point(tradingDate: string, pe: number | null, pb: number | null): ValuationHistoryPoint {
  return { tradingDate, pe, pb }
}

async function loadValuationSnapshot() {
  const modulePath = path.resolve("modules/research/market-insight/valuation-snapshot.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-190 must add a pure valuation snapshot helper")
  return import(pathToFileURL(modulePath).href)
}

test("QEO-190 computes PE and PB snapshots from the selected metric with mid-rank percentile", async () => {
  const { buildValuationSnapshot } = await loadValuationSnapshot()
  const history = Array.from({ length: 20 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0")
    return point(`2026-08-${day}`, index + 1, 20 - index)
  })

  const pe = buildValuationSnapshot({ metric: "PE", history, rangeYears: 0 })
  const pb = buildValuationSnapshot({ metric: "PB", history, rangeYears: 0 })

  assert.equal(pe.current, 20)
  assert.equal(pe.mean, 10.5)
  assert.equal(pe.median, 10.5)
  assert.equal(pe.percentile, 97.5)
  assert.ok(pe.zScore != null && Math.abs(pe.zScore - 1.647508942095828) < 1e-12)
  assert.equal(pe.interpretation, "above_average")

  assert.equal(pb.current, 1)
  assert.equal(pb.mean, 10.5)
  assert.equal(pb.median, 10.5)
  assert.equal(pb.percentile, 2.5)
  assert.ok(pb.zScore != null && Math.abs(pb.zScore + 1.647508942095828) < 1e-12)
  assert.equal(pb.interpretation, "below_average")
})

test("QEO-190 filters valuation history by selected calendar-year window using the latest observation as anchor", async () => {
  const { buildValuationSnapshot } = await loadValuationSnapshot()
  const history = [
    point("2024-09-10", 11, 1.1),
    point("2025-09-09", 12, 1.2),
    point("2025-09-10", 13, 1.3),
    point("2026-09-10", 14, 1.4),
  ]

  const oneYear = buildValuationSnapshot({ metric: "PE", history, rangeYears: 1 })
  const threeYears = buildValuationSnapshot({ metric: "PE", history, rangeYears: 3 })

  assert.equal(oneYear.sampleSize, 2)
  assert.equal(oneYear.windowStartDate, "2025-09-10")
  assert.equal(oneYear.windowEndDate, "2026-09-10")
  assert.equal(oneYear.current, 14)
  assert.equal(threeYears.sampleSize, 4)
})

test("QEO-190 keeps mean and median available but withholds percentile and z-score below 20 valid observations", async () => {
  const { buildValuationSnapshot } = await loadValuationSnapshot()
  const history = Array.from({ length: 19 }, (_, index) => point(`2026-08-${String(index + 1).padStart(2, "0")}`, 10 + index, 1 + index / 10))

  const result = buildValuationSnapshot({ metric: "PE", history, rangeYears: 0 })

  assert.equal(result.sampleSize, 19)
  assert.equal(result.current, 28)
  assert.equal(result.mean, 19)
  assert.equal(result.median, 19)
  assert.equal(result.percentile, null)
  assert.equal(result.zScore, null)
  assert.equal(result.interpretation, "unknown")
})

test("QEO-190 allows percentile with sufficient history but withholds z-score when variance is zero", async () => {
  const { buildValuationSnapshot } = await loadValuationSnapshot()
  const history = Array.from({ length: 20 }, (_, index) => point(`2026-08-${String(index + 1).padStart(2, "0")}`, 15, 1.5))

  const result = buildValuationSnapshot({ metric: "PE", history, rangeYears: 0 })

  assert.equal(result.sampleSize, 20)
  assert.equal(result.percentile, 50)
  assert.equal(result.standardDeviation, 0)
  assert.equal(result.zScore, null)
  assert.equal(result.interpretation, "unknown")
})

test("QEO-190 interpretation boundaries stay neutral and rule-based", async () => {
  const { interpretValuationZScore } = await loadValuationSnapshot()

  assert.equal(interpretValuationZScore(-1), "below_average")
  assert.equal(interpretValuationZScore(-0.999), "around_average")
  assert.equal(interpretValuationZScore(0.999), "around_average")
  assert.equal(interpretValuationZScore(1), "above_average")
  assert.equal(interpretValuationZScore(null), "unknown")
})

test("QEO-190 wires the selected PE/PB metric and history window into a compact valuation snapshot", () => {
  const healthView = read("components/insights/market-health-view.tsx")
  const snapshotView = read("components/insights/valuation-snapshot.tsx")
  const visibleSurface = `${healthView}\n${snapshotView}`

  assert.match(healthView, /VALUATION_HISTORY_RANGES[\s\S]*1Y[\s\S]*3Y[\s\S]*5Y[\s\S]*Tất cả/)
  assert.match(healthView, /valuationRangeYears/)
  assert.match(healthView, /buildValuationSnapshot\([\s\S]*metric:\s*valuationMetric[\s\S]*history:\s*data\.dailySummary\.valuationHistory[\s\S]*rangeYears:\s*valuationRangeYears/)
  assert.match(healthView, /visibleValuationSeries/)
  assert.match(healthView, /<ValuationSnapshot[\s\S]*snapshot=\{valuationSnapshot\}/)
  assert.match(snapshotView, /data-valuation-snapshot/)
  assert.match(visibleSurface, /Hiện tại/)
  assert.match(visibleSurface, /Trung vị/)
  assert.match(visibleSurface, /Trung bình/)
  assert.match(visibleSurface, /Percentile/)
  assert.match(visibleSurface, /σ so với TB/)
  assert.match(visibleSurface, /Chưa đủ dữ liệu/)
  assert.doesNotMatch(visibleSurface, /mục tiêu giá|target price|upside|downside/i, "valuation snapshot must stay descriptive rather than become a price forecast")
})
