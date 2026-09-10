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
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  assert.match(chartData, /exchange\?: string/)
  assert.match(chartData, /sessionState=\{liveState\}/)
  assert.match(chartData, /providerWarning=/)
  assert.doesNotMatch(chartData, />\s*LIVE\{liveProvider/)

  assert.match(chart, /data-chart-financial-header/)
  assert.match(chart, /tabular-nums/)
  assert.match(chart, /exchange/)
  assert.match(chart, /sessionState/)
  assert.match(chart, /providerWarning/)
})

test("QEO-173 pane headers share the canonical legend timestamp and expose inline controls", () => {
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")

  for (const pane of ["volume", "rsi", "macd"]) {
    assert.match(chart, new RegExp(`data-chart-pane-header=["']${pane}["']`))
  }
  assert.match(chart, /data-chart-pane-time=\{legendTime \?\? ""\}/)
  assert.match(chart, /formatCompactVolume\(activeBar\?\.volume\)/)
  assert.match(chart, /formatMetric\(legendValues\.rsi\)/)
  assert.match(chart, /formatMetric\(legendValues\.macd, 4\)/)
  assert.match(chart, /setShowIndicatorModal\(true\)/)
  assert.match(chart, /setIsRsiCollapsed/)
  assert.match(chart, /setIsMacdCollapsed/)
})

test("QEO-173 loading and terminal chrome preserve plot density", () => {
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")
  const css = source("components/stock-detail/chart/stock-chart-terminal-shell.module.css")

  assert.match(chart, /data-chart-loading-indicator/)
  assert.doesNotMatch(chart, /loadingState[\s\S]{0,500}grid place-items-center/)
  assert.match(chart, /lastValueVisible:\s*true/)
  assert.match(chart, /width - priceAxisGutter/)
  assert.match(chart, /data-chart-legend-time=\{legendTime \?\? ""\}/)

  assert.match(css, /min-height:\s*32px/)
  assert.match(css, /min-height:\s*24px/)
  assert.match(css, /width:\s*28px/)
  assert.match(css, /height:\s*28px/)
  assert.doesNotMatch(css, /backdrop-filter:\s*blur/)
})
