import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-174 keeps factual stock-card presentation without the retired price arena", async () => {
  const metrics = await import("../../components/stock-detail/revamp/stock-card-metrics.ts")
  const stat = source("components/stock-detail/revamp/stock-card-stat.tsx")

  assert.equal(metrics.formatCompactNumber(1_250_000), "1,3M")
  assert.match(stat, /CARD STATS|StockCardStat/)
  assert.doesNotMatch(stat, /rarity|legendary|power score|attack|defense/i)
})

test("QEO-174 keeps the strategy-card hero but removes PRICE ARENA", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")

  assert.match(header, /data-qeo174-strategy-card/)
  assert.match(header, /STOCK CARD/)
  assert.match(header, /CARD STATS/)
  assert.doesNotMatch(header, /StockPriceArena|PRICE ARENA|stock-price-arena/)
  assert.match(header, /StockCardStat/)
  assert.match(header, /useReducedMotion/)
  assert.match(header, /rank/)
  assert.match(header, /P\/E/)
  assert.match(header, /P\/B/)
  assert.match(header, /ROE/)
  assert.match(header, /EPS/)
  assert.match(header, /Bookmark/)
  assert.match(header, /Share2/)
  assert.doesNotMatch(header, /rarity|legendary|power score/i)
})

test("QEO-174 renders CARD STATS as a compact flat strip", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")
  const stat = source("components/stock-detail/revamp/stock-card-stat.tsx")

  assert.match(header, /grid grid-cols-3/)
  assert.match(header, /xl:grid-cols-6/)
  assert.doesNotMatch(header, /Fundamental \+ market snapshot/)
  assert.doesNotMatch(header, /VND \/ cp|phiên hiện tại/)

  assert.match(stat, /border-l/)
  assert.match(stat, /py-1\.5/)
  assert.doesNotMatch(stat, /rounded-2xl|bg-black\/20|group\/stat/)
  assert.doesNotMatch(stat, /detail\??:|detail,/)
})

test("QEO-174 expands the compact mini chart while preserving maximize behavior", () => {
  const chartShell = source("components/stock-detail/chart/stock-chart-terminal-shell.module.css")
  const chart = source("components/stock-detail/stock-tradingview-chart.tsx")
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(chartShell, /min-height:\s*420px/)
  assert.match(chartShell, /min-height:\s*460px/)
  assert.match(chartShell, /min-height:\s*500px/)
  assert.match(chart, /isMaximized \? "h-full"/)

  assert.match(workstation, /data-qeo174-workstation/)
  assert.match(workstation, /StockAiSidebar/)
  assert.match(workstation, /StockCompanyHeader/)
  assert.match(workstation, /StockTradingViewChartData/)
  assert.match(workstation, /StockTabsPanel/)
  assert.match(workstation, /StockWatchlistSidebar/)
  assert.match(workstation, /setIsChartMaximized/)
  assert.match(workstation, /handleSelectTicker/)
})
