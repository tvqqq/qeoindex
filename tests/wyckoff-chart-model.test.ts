import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import type { OhlcvBar } from "../lib/technical-indicators.ts"
import { buildWyckoffChartStudies, isWyckoffChartTimeframe, type WyckoffScenario } from "../lib/wyckoff-chart-model.ts"

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
  assert.equal(studies.every((study) => study.outlooks.length === 3), true)
  assert.deepEqual(studies[0].outlooks.map((outlook) => outlook.sourceTimeframe), ["1D", "1W", "1M"])

  for (const study of studies) {
    assert.equal(study.scenarios.reduce((sum, scenario) => sum + scenario.probability, 0), 100)
    assert.equal(study.scenarios.every((scenario) => scenario.path.at(-1)!.time > study.bars.at(-1)!.time), true)
  }
})

test("scanner-published markers and scenarios override runtime projections", () => {
  const dailyBars = bars(2_920, 86_400, 1_514_764_800)
  const hourlyBars = bars(900, 3_600, 1_775_000_000)
  const last = dailyBars.at(-1)!
  const published = ([
    { key: "bull", label: "Bull published", probability: 45, color: "#22c98a", target: last.close + 3, path: [{ time: last.time + 86_400, value: last.close }, { time: last.time + 172_800, value: last.close + 3 }], description: "Published bull", horizon: "week" },
    { key: "base", label: "Base published", probability: 35, color: "#a7b0bd", target: last.close + 1, path: [{ time: last.time + 86_400, value: last.close }, { time: last.time + 172_800, value: last.close + 1 }], description: "Published base", horizon: "week" },
    { key: "bear", label: "Bear published", probability: 20, color: "#ff4757", target: last.close - 2, path: [{ time: last.time + 86_400, value: last.close }, { time: last.time + 172_800, value: last.close - 2 }], description: "Published bear", horizon: "week" },
  ] satisfies WyckoffScenario[])

  const studies = buildWyckoffChartStudies({
    dailyBars,
    hourlyBars,
    dailyProvider: "DNSE",
    dailyDetail: "Daily test bars",
    hourlyProvider: "DNSE",
    hourlyDetail: "Hourly test bars",
    markerOverrides: { "1D": [{ time: last.time, label: "TEST", tone: "neutral", detail: "Scanner Test marker" }] },
    scenarioOverrides: { "1D": published },
  })

  const daily = studies.find((study) => study.timeframe === "1D")!
  assert.equal(daily.markers[0].label, "TEST")
  assert.equal(daily.scenarios[0].label, "Bull published")
  assert.equal(daily.scenarios[0].horizon, "week")
  assert.equal(daily.outlooks.find((outlook) => outlook.key === "week")?.scenarios[0].label, "Bull published")
})

test("Wyckoff chart validates shareable timeframe query values", () => {
  for (const value of ["1H", "4H", "1D", "1W", "1M"]) assert.equal(isWyckoffChartTimeframe(value), true)
  for (const value of ["D", "5m", "daily", "", null]) assert.equal(isWyckoffChartTimeframe(value), false)
})

test("chart route exposes query links, attribution, markers, scenario lines, and insight panels", () => {
  const dashboard = readFileSync(new URL("../components/insights/wyckoff-chart-dashboard.tsx", import.meta.url), "utf8")
  const chart = readFileSync(new URL("../components/insights/wyckoff-lightweight-chart.tsx", import.meta.url), "utf8")
  const page = readFileSync(new URL("../app/insights/wyckoff/page.tsx", import.meta.url), "utf8")

  assert.match(dashboard, /\/insights\/wyckoff\?ticker=/)
  assert.match(dashboard, /timeframe=\$\{activeTimeframe\}/)
  assert.match(page, /searchParams: Promise/)
  assert.match(chart, /attributionLogo: true/)
  assert.match(chart, /createSeriesMarkers/)
  assert.match(chart, /lwc\.LineSeries/)
  assert.match(chart, /data-wyckoff-signal-panel/)
  assert.match(chart, /data-wyckoff-key-levels/)
  assert.match(chart, /data-wyckoff-horizon-outlook/)
  assert.match(dashboard, /không phải dữ liệu giá tương lai/)
})
