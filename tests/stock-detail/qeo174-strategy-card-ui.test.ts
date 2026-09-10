import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-177 keeps the stock-detail hero factual while removing the legacy CARD STATS strip", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")

  assert.match(header, /data-qeo174-strategy-card/)
  assert.match(header, /useReducedMotion/)
  assert.match(header, /rank/)
  assert.match(header, /Bookmark/)
  assert.match(header, /Share2/)
  assert.doesNotMatch(header, /StockPriceArena|PRICE ARENA|stock-price-arena/)
  assert.doesNotMatch(header, /CARD STATS/)
  assert.doesNotMatch(header, /StockCardStat/)
  assert.doesNotMatch(header, /stock-card-metrics/)
  assert.doesNotMatch(header, /label="P\/E"|label="P\/B"|label="ROE"|label="EPS"|label="Khối lượng"|label="Vốn hóa"/)
  assert.doesNotMatch(header, /rarity|legendary|power score/i)
})

test("QEO-177 renders Qeo Composite before the live price and reuses ratingRow data", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")

  assert.match(header, /QeoCompositeTrend/)
  assert.match(header, /row=\{data\.ratingRow\}/)
  assert.ok(
    header.indexOf("<QeoCompositeTrend") < header.indexOf('price.toLocaleString("vi-VN")'),
    "Qeo Composite must be rendered before the current price",
  )

  assert.match(trend, /data-qeo-composite-trend/)
  assert.match(trend, /QEO COMPOSITE/)
  assert.match(trend, /row\.ratingScore/)
  assert.match(trend, /row\.scoreHistory/)
  assert.match(trend, /<svg/)
})

test("QEO-178 restores the legacy Stock Detail hero visual skin without restoring CARD STATS", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")

  assert.match(header, /rounded-\[28px\]/)
  assert.match(header, /border-indigo-300\/\[0\.16\]/)
  assert.match(header, /shadow-\[0_22px_70px_rgba\(0,0,0,0\.34\)\]/)
  assert.match(header, /-right-20 -top-24 size-56 rounded-full border border-cyan-300\/10/)
  assert.match(header, /shadow-\[0_0_80px_rgba\(34,211,238,0\.08\)\]/)
  assert.doesNotMatch(header, /CARD STATS|StockCardStat|stock-card-metrics/)
})

test("QEO-178 Qeo Composite is chart-first and consumes real stock-history composite data", () => {
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")
  const historyRoute = source("app/api/insights/stock-history/route.ts")

  assert.match(historyRoute, /kfsp_composite_score/)
  assert.match(historyRoute, /compositeScore:\s*numberOrNull\(row\.kfsp_composite_score\)/)
  assert.match(trend, /\/api\/insights\/stock-history\?ticker=/)
  assert.match(trend, /compositeScore/)
  assert.match(trend, /data-qeo-composite-chart/)
  assert.match(trend, /polyline/)
  assert.match(trend, /circle/)
  assert.match(trend, /Xu hướng Qeo Composite/)
})

test("QEO-179 moves market-cap rank into the identity metadata row", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")
  const identity = source("components/stock-identity.tsx")

  assert.match(header, /marketCapRank=\{rank\}/)
  assert.doesNotMatch(header, /<Trophy|Trophy className|>\s*#\{rank\}/)
  assert.match(identity, /marketCapRank\?: number/)
  assert.match(identity, /Hạng vốn hoá/)
  assert.match(identity, /#\{marketCapRank\}/)
})

test("QEO-179 shows the last five stock RS values as ordered progress rings before Qeo Composite", () => {
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")
  const historyRoute = source("app/api/insights/stock-history/route.ts")

  assert.match(historyRoute, /stockRs:\s*numberOrNull\(row\.kfsp_stock_rs_score\)/)
  assert.match(trend, /stockRs/)
  assert.match(trend, /slice\(-5\)/)
  assert.match(trend, /data-rs-history/)
  assert.match(trend, /data-rs-ring/)
  assert.match(trend, /data-current-rs/)
  assert.match(trend, /conic-gradient/)
  assert.ok(
    trend.indexOf("data-rs-history") < trend.indexOf("QEO COMPOSITE"),
    "RS history must render to the left of Qeo Composite",
  )
  assert.equal(
    (trend.match(/\/api\/insights\/stock-history\?ticker=/g) || []).length,
    1,
    "RS and Qeo Composite must share one stock-history request",
  )
})

test("QEO-177 removes the duplicate full Qeo Composite history block from the overview tab", () => {
  const tabs = source("components/stock-detail/stock-tabs-panel.tsx")

  assert.doesNotMatch(tabs, /function RatingHistoryChart/)
  assert.doesNotMatch(tabs, /<RatingHistoryChart row=\{row\} \/>/)
  assert.doesNotMatch(tabs, /Xu hướng Qeo composite qua các phiên/)
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
