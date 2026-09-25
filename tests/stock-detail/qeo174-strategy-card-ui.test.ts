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
  assert.match(header, /marketCapT/)
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
  assert.match(trend, /StockChartCnSparkline/)
  assert.doesNotMatch(trend, /<svg/)
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
  const chartcn = source("components/stock-detail/stock-chartcn.tsx")
  const historyRoute = source("app/api/insights/stock-history/route.ts")

  assert.match(historyRoute, /kfsp_composite_score/)
  assert.match(historyRoute, /compositeScore:\s*numberOrNull\(row\.kfsp_composite_score\)/)
  assert.match(trend, /\/api\/insights\/stock-history\?ticker=/)
  assert.match(trend, /compositeScore/)
  assert.match(trend, /data-qeo-composite-chart/)
  assert.match(trend, /StockChartCnSparkline/)
  assert.match(chartcn, /<LineChart/)
  assert.match(chartcn, /<ChartTooltip/)
  assert.match(chartcn, /strokeWidth=\{2\.5\}/)
  assert.match(trend, /Xu hướng Qeo Composite/)
})

test("QEO-181 replaces market-cap rank metadata with compact actual market cap", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")
  const identity = source("components/stock-identity.tsx")

  assert.match(header, /marketCapT=\{marketCapT\}/)
  assert.doesNotMatch(header, /marketCapRank=\{rank\}/)
  assert.match(identity, /marketCapT\?: number/)
  assert.match(identity, /formatCompactMarketCap/)
  assert.match(identity, /Vốn hoá/)
  assert.match(identity, /k tỷ/)
  assert.doesNotMatch(identity, /Hạng vốn hoá|marketCapRank/)
})

test("QEO-194 shows the last five stock RS values as filled circles without a percentage ring", () => {
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")
  const historyRoute = source("app/api/insights/stock-history/route.ts")

  assert.match(historyRoute, /stockRs:\s*numberOrNull\(row\.kfsp_stock_rs_score\)/)
  assert.match(trend, /stockRs/)
  assert.match(trend, /slice\(-5\)/)
  assert.match(trend, /data-rs-history/)
  assert.match(trend, /data-rs-ring/)
  assert.match(trend, /data-current-rs/)
  assert.doesNotMatch(trend, /conic-gradient/)
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

test("QEO-181 uses five Qeo Composite sessions with ChartCN tooltip values and no /100 suffix", () => {
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")
  const chartcn = source("components/stock-detail/stock-chartcn.tsx")

  assert.match(trend, /const compositeHistory/)
  assert.match(trend, /compositeHistory[\s\S]*?slice\(-5\)/)
  assert.match(trend, /StockChartCnSparkline/)
  assert.match(chartcn, /ChartTooltipContent/)
  assert.match(chartcn, /activeDot/)
  assert.doesNotMatch(trend, /\/100/)
})

test("QEO-181 makes RS circles larger, filled, and keeps the latest marker", () => {
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")

  assert.match(trend, /size-10/)
  assert.match(trend, /text-\[14px\]/)
  assert.match(trend, /backgroundColor:\s*rsRingColor/)
  assert.match(trend, /data-current-rs/)
  assert.doesNotMatch(trend, /bg-\[#0a1019\]/)
})

test("QEO-193 removes RS outer borders and delegates Qeo tooltip rendering to the shared chart template", () => {
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")
  const chartcn = source("components/stock-detail/stock-chartcn.tsx")

  assert.match(trend, /data-current-rs/)
  assert.doesNotMatch(trend, /border-2 border-transparent/)
  assert.doesNotMatch(trend, /border-cyan-100\/90/)
  assert.match(trend, /StockChartCnSparkline/)
  assert.match(chartcn, /ChartTooltipContent/)
  assert.doesNotMatch(trend, /data-qeo-composite-tooltip/)
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


test("QEO-279 standardizes Stock Detail analytical charts on the shared ChartCN-style Recharts template", () => {
  const chartcn = source("components/stock-detail/stock-chartcn.tsx")
  const tabs = source("components/stock-detail/stock-tabs-panel.tsx")
  const trend = source("components/stock-detail/qeo-composite-trend.tsx")
  const ttai = source("components/insights/ttai-dashboard.tsx")
  const tradingChart = source("components/stock-detail/stock-tradingview-chart.tsx")
  const notices = source("THIRD_PARTY_NOTICES.md")

  assert.match(chartcn, /ChartContainer/)
  assert.match(chartcn, /StockChartCnSparkline/)
  assert.match(chartcn, /StockChartCnSignedBars/)
  assert.match(chartcn, /StockChartCnBars/)
  assert.match(chartcn, /StockChartCnRadar/)
  assert.match(chartcn, /strokeDasharray="3 5"/)
  assert.match(chartcn, /radius=\{\[6, 6, 6, 6\]\}/)

  assert.match(trend, /StockChartCnSparkline/)
  assert.match(tabs, /StockChartCnRadar/)
  assert.match(tabs, /StockChartCnSignedBars/)
  assert.match(tabs, /StockChartCnBars/)
  assert.doesNotMatch(tabs, /function radarPoints/)
  assert.doesNotMatch(tabs, /<svg viewBox="0 0 280 280"/)

  assert.match(ttai, /strokeDasharray="3 5"/)
  assert.match(tradingChart, /loadLightweightCharts/)
  assert.doesNotMatch(tradingChart, /StockChartCn/)
  assert.match(notices, /ChartCN \/ ShadcnDeck/)
})
