import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-173 keeps ticker transitions usable and visually non-disruptive", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.doesNotMatch(workstation, /AiLoader/)
  assert.doesNotMatch(workstation, /opacity-35 pointer-events-none/)
  assert.doesNotMatch(workstation, /Hội đồng AI đang cập nhật dữ liệu/)
  assert.match(workstation, /data-qeo173-transition-indicator/)
  assert.match(workstation, /currentData\.exchange/)
})

test("QEO-173 exposes a compact financial header and only surfaces provider noise on stale state", () => {
  const chartData = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  assert.match(chartData, /exchange\?: string/)
  assert.match(chartData, /providerWarning/)
  assert.doesNotMatch(chartData, />\s*LIVE\{liveProvider/)
  assert.match(chartData, /data-chart-financial-header/)
  assert.match(chartData, /tabular-nums/)
  assert.match(chartData, /exchange/)
  assert.match(chartData, /liveState/)
})

test("QEO-173 pane headers follow the chart canonical legend timestamp and expose inline controls", () => {
  const chartData = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  for (const pane of ["volume", "rsi", "macd"]) {
    assert.match(chartData, new RegExp(`data-chart-pane-header=["']${pane}["']`))
  }
  assert.match(chartData, /data-chart-pane-time=\{paneTime \?\? ""\}/)
  assert.match(chartData, /MutationObserver/)
  assert.match(chartData, /data-chart-legend-time/)
  assert.match(chartData, /calculateVolumeSma/)
  assert.match(chartData, /calculateRsiSeries/)
  assert.match(chartData, /calculateMacdSeries/)
  assert.match(chartData, /clickChartControl/)
  assert.match(chart, /data-chart-legend-time=\{legendTime \?\? ""\}/)
})

test("QEO-173 loading and terminal chrome preserve plot density without changing chart data math", () => {
  const chartData = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")
  const css = source("components/stock-detail/chart/stock-chart-terminal-shell.module.css")

  assert.match(chartData, /data-chart-loading-indicator/)
  assert.match(css, /data-chart-loading=["']true["']/)
  assert.match(chart, /lastValueVisible:\s*true/)
  assert.match(chart, /width - priceAxisGutter/)

  assert.match(css, /min-height:\s*32px/)
  assert.match(css, /min-height:\s*24px/)
  assert.match(css, /width:\s*28px/)
  assert.match(css, /height:\s*28px/)
  assert.doesNotMatch(css, /backdrop-filter:\s*blur/)
})
