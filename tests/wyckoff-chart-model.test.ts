import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import type { OhlcvBar } from "../lib/technical-indicators.ts"
import { buildWyckoffChartStudies, isWyckoffChartTimeframe } from "../lib/wyckoff-chart-model.ts"

function bars(count: number, interval: number, start: number): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => {
    const baseline = 20 + index * 0.025 + Math.sin(index / 11) * 0.8
    const open = baseline - Math.sin(index / 5) * 0.15
    const close = baseline + Math.cos(index / 7) * 0.16
    return {
      time: start + interval * index,
      open,
      high: Math.max(open, close) + 0.35,
      low: Math.min(open, close) - 0.35,
      close,
      volume: 1_000_000 + (index % 20) * 45_000,
    }
  })
}

test("Wyckoff chart builds one unified study for every requested timeframe", () => {
  const studies = buildWyckoffChartStudies({
    dailyBars: bars(2_920, 86_400, 1_514_764_800),
    hourlyBars: bars(900, 3_600, 1_775_000_000),
    dailyProvider: "DNSE",
    dailyDetail: "Daily test bars",
    hourlyProvider: "DNSE",
    hourlyDetail: "Hourly test bars",
  })

  assert.deepEqual(studies.map((study) => study.timeframe), ["1H", "4H", "1D", "1W", "1M"])
  assert.equal(studies.every((study) => study.bars.length <= 260), true)
  assert.equal(studies.every((study) => study.analysis !== null), true)
  assert.equal(studies.every((study) => study.scenarios.length === 3), true)

  for (const study of studies) {
    assert.equal(study.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0), 100)
    assert.equal(study.scenarios.every((scenario) => scenario.path.at(-1)!.time > study.bars.at(-1)!.time), true)
  }
})

test("Wyckoff chart validates shareable timeframe query values", () => {
  for (const value of ["1H", "4H", "1D", "1W", "1M"]) assert.equal(isWyckoffChartTimeframe(value), true)
  for (const value of ["D", "5m", "daily", "", null]) assert.equal(isWyckoffChartTimeframe(value), false)
})

test("chart route exposes query links, attribution, markers, and scenario lines", () => {
  const dashboard = readFileSync(new URL("../components/insights/wyckoff-chart-dashboard.tsx", import.meta.url), "utf8")
  const chart = readFileSync(new URL("../components/insights/wyckoff-lightweight-chart.tsx", import.meta.url), "utf8")
  const page = readFileSync(new URL("../app/insights/wyckoff/page.tsx", import.meta.url), "utf8")

  assert.match(dashboard, /\/insights\/wyckoff\?ticker=/)
  assert.match(dashboard, /timeframe=\$\{activeTimeframe\}/)
  assert.match(page, /searchParams: Promise/)
  assert.match(chart, /attributionLogo: true/)
  assert.match(chart, /createSeriesMarkers/)
  assert.match(chart, /lwc\.LineSeries/)
  assert.match(dashboard, /không phải dữ liệu giá tương lai/)
})
