import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 timeframe switches reuse the existing Lightweight Charts instance", () => {
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.doesNotMatch(
    chart,
    /\}, \[scheduleOverlayPaint, ticker, timeframe\]\)/,
    "chart lifecycle must not destroy and recreate the LWC instance for a timeframe-only switch",
  )
  assert.match(
    chart,
    /\}, \[scheduleOverlayPaint, ticker\]\)/,
    "chart lifecycle should remain ticker-owned so ticker navigation can still recreate the instance",
  )
})

test("QEO-172 reused chart updates timeframe-dependent axis formatting in place", () => {
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  const syncStart = chart.indexOf("// Keep timeframe-specific axis formatting")
  const syncEnd = chart.indexOf("useEffect(() => {\n    const chart = chartRef.current\n    const series", syncStart)
  const syncBlock = chart.slice(syncStart, syncEnd)

  assert.ok(syncStart >= 0 && syncEnd > syncStart, "timeframe option sync effect must remain discoverable")
  assert.match(syncBlock, /chart\.applyOptions\(/)
  assert.match(syncBlock, /timeVisible: timeframe\.includes\("m"\) \|\| timeframe\.includes\("h"\)/)
  assert.match(syncBlock, /tickMarkFormatter: \(time: unknown\) => formatAxisTime\(time, timeframe\)/)
  assert.match(syncBlock, /timeFormatter: \(time: unknown\) => formatCrosshairTime\(time, timeframe\)/)
  assert.match(syncBlock, /\[chartReady, timeframe\]/)
})

test("QEO-172 timeframe reuse resets render bookkeeping before applying the new dataset", () => {
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(chart, /const renderedTimeframeRef = useRef<ChartTimeframe \| null>\(null\)/)
  const applyStart = chart.indexOf("const previousTimeframe = renderedTimeframeRef.current")
  const applyEnd = chart.indexOf("series.futureAxis.setData", applyStart)
  const boundaryBlock = chart.slice(applyStart, applyEnd)

  assert.ok(applyStart >= 0 && applyEnd > applyStart, "timeframe render boundary must remain discoverable")
  assert.match(boundaryBlock, /const timeframeChanged = previousTimeframe !== timeframe/)
  assert.match(boundaryBlock, /renderedRef\.current = null/)
  assert.match(boundaryBlock, /visibleRangeRef\.current = null/)
  assert.match(boundaryBlock, /renderedTimeframeRef\.current = timeframe/)
})
