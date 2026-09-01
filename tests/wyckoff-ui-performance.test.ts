import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const dashboard = readFileSync("components/insights/wyckoff-infographic-dashboard.tsx", "utf8")
const deferred = readFileSync("components/insights/wyckoff-deferred-dashboard.tsx", "utf8")
const chart = readFileSync("components/insights/wyckoff-lightweight-chart.tsx", "utf8")
const chartRuntime = readFileSync("lib/lightweight-charts-runtime.ts", "utf8")
const stockIdentity = readFileSync("components/stock-identity.tsx", "utf8")
const insightsDashboard = readFileSync("components/insights/insights-dashboard.tsx", "utf8")
const orderbook = readFileSync("components/orderbook/live-orderbook-panel.tsx", "utf8")
const page = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const tickerApi = readFileSync("app/api/insights/wyckoff/route.ts", "utf8")
const unifiedData = readFileSync("lib/wyckoff-unified-data.ts", "utf8")
const metadata = readFileSync("lib/wyckoff-company-metadata.ts", "utf8")
const animatedTabs = readFileSync("components/smoothui/animated-tabs/index.tsx", "utf8")
const aiLoader = readFileSync("components/smoothui/ai-loader/index.tsx", "utf8")
const priceFlow = readFileSync("components/smoothui/price-flow/index.tsx", "utf8")
const marketSectors = readFileSync("lib/market-sectors.ts", "utf8")

test("Wyckoff header uses canonical stock identity and removes the Rating back row", () => {
  assert.match(dashboard, /import \{ StockIdentity \}/)
  assert.match(dashboard, /<StockIdentity/)
  assert.match(dashboard, /ticker=\{activeTicker\}/)
  assert.doesNotMatch(dashboard, /function SymbolIdentity/)
  assert.doesNotMatch(dashboard, /data-wyckoff-back-row|Quay lại Rating|>\s*Rating\s*</)
  assert.doesNotMatch(dashboard, /ArrowLeft/)
})

test("stock identity convention matches stock detail and orderbook popup styling", () => {
  const tickerGradient = "bg-gradient-to-br from-white via-cyan-100 to-emerald-200 bg-clip-text text-transparent"
  const logoGlow = "drop-shadow-[0_0_8px_rgba(255,255,255,0.75)]"
  const tickerGlow = "drop-shadow-[0_0_15px_rgba(34,211,238,0.2)]"

  assert.match(stockIdentity, /export const STOCK_IDENTITY_LOGO_CLASS/)
  assert.match(stockIdentity, /export const STOCK_IDENTITY_TICKER_CLASS/)
  assert.ok(stockIdentity.includes(tickerGradient))
  assert.ok(stockIdentity.includes(logoGlow))
  assert.ok(stockIdentity.includes(tickerGlow))
  assert.ok(insightsDashboard.includes(tickerGradient))
  assert.ok(insightsDashboard.includes(logoGlow))
  assert.ok(insightsDashboard.includes(tickerGlow))
  assert.ok(orderbook.includes(tickerGradient))
  assert.ok(orderbook.includes(logoGlow))
  assert.ok(orderbook.includes(tickerGlow))
})

test("Wyckoff watchlist stays ticker-first and groups rows by market-board sector taxonomy", () => {
  assert.match(dashboard, /BOARD_SECTOR_GROUPS/)
  assert.match(dashboard, /boardSectorGroupForSector/)
  assert.match(marketSectors, /BOARD_SECTOR_GROUPS/)
  for (const key of ["bank", "securities", "consumer", "real-estate", "industrial-tech", "other"]) {
    assert.ok(marketSectors.includes(`key: "${key}"`))
  }
  assert.match(dashboard, /WATCHLIST_SECTOR_ICON/)
  assert.match(dashboard, /phaseFor\(stock, "1H"\)/)
  assert.match(dashboard, /phaseFor\(stock, "1D"\)/)
  assert.match(dashboard, /phaseFor\(stock, "1W"\)/)
})

test("Wyckoff phase columns remain compact and bounded across 1H 1D 1W", () => {
  assert.match(dashboard, /WATCHLIST_GRID_CLASS = "grid-cols-\[68px_repeat\(3,minmax\(0,1fr\)\)\]"/)
  assert.match(dashboard, /watchLabel: "RE-ACC"/)
  assert.match(dashboard, /watchLabel: "RE-DIST"/)
  assert.match(dashboard, /watchLabel: "MARKUP"/)
  assert.match(dashboard, /watchLabel: "MARKDN"/)
  assert.match(dashboard, /watchLabel: "UNCLASS"/)
})

test("Wyckoff ticker switching remains cancellable and latest-click-wins", () => {
  assert.match(dashboard, /TICKER_SWITCH_DEBOUNCE_MS = 60/)
  assert.match(dashboard, /TICKER_CACHE_LIMIT = 8/)
  assert.match(dashboard, /new AbortController\(\)/)
  assert.match(dashboard, /fetch\(`\/api\/insights\/wyckoff\?ticker=/)
  assert.match(dashboard, /window\.history\.replaceState/)
  assert.doesNotMatch(dashboard, /router\.refresh\(\)|window\.history\.pushState|useRouter/)
})

test("Wyckoff ticker endpoint is authenticated and canonical-universe scoped", () => {
  assert.match(tickerApi, /requireApiUser/)
  assert.match(tickerApi, /getCanonicalUniverse/)
  assert.match(tickerApi, /canonical\.stocks\.find/)
  assert.match(tickerApi, /getUnifiedWyckoffTickerData/)
  assert.match(tickerApi, /Cache-Control/)
  assert.match(unifiedData, /export async function getUnifiedWyckoffTickerData/)
  const selectedStart = unifiedData.indexOf("export async function getUnifiedWyckoffTickerData")
  const selectedSource = unifiedData.slice(selectedStart)
  assert.match(selectedSource, /\.eq\("ticker", ticker\)/)
  assert.match(selectedSource, /getWyckoffCompanyMetadata\(supabase, \[ticker\]\)/)
})

test("Wyckoff timeframe keeps bounded SmoothUI AnimatedTabs inside the chart toolbar", () => {
  assert.match(dashboard, /import \{ AnimatedTabs \}/)
  assert.match(dashboard, /data-wyckoff-chart-toolbar/)
  assert.match(dashboard, /<AnimatedTabs/)
  assert.match(animatedTabs, /layoutId=/)
  assert.match(animatedTabs, /useReducedMotion/)
  assert.doesNotMatch(animatedTabs, /transition-all|backdrop-blur|backdrop-filter|filter:/)
})

test("chart loading is visual-only inside chart content and compositor-safe", () => {
  assert.match(chart, /loading = false/)
  assert.match(chart, /<AiLoader/)
  assert.match(chart, /showLabel=\{false\}/)
  assert.match(chart, /compositorSafe/)
  assert.match(chart, /\[contain:layout_paint\]/)
  assert.match(aiLoader, /showLabel = true/)
  assert.match(aiLoader, /compositorSafe = false/)
  assert.doesNotMatch(aiLoader, /backdrop-blur|backdrop-filter|filter:/)
})

test("Price Flow is suppressed during ticker commits to avoid simultaneous compositor work", () => {
  assert.match(dashboard, /suppressValueMotion/)
  assert.match(dashboard, /setSuppressValueMotion\(true\)/)
  assert.match(dashboard, /animate=\{priceMotion\}/)
  assert.match(priceFlow, /animate = true/)
  assert.match(priceFlow, /const shouldAnimate = animate && !reducedMotion/)
})

test("Wyckoff chart keeps one persistent canvas surface and updates series in place", () => {
  assert.match(chart, /controllerRef/)
  assert.match(chart, /function applyStudy/)
  assert.match(chart, /controller\.candles\.setData/)
  assert.match(chart, /controller\.volume\.setData/)
  assert.match(chart, /series\.applyOptions/)
  assert.match(chart, /series\.setData/)
  assert.match(chart, /removePriceLine/)
  assert.doesNotMatch(chart, /document\.createElement\("div"\)/)
})

test("Wyckoff chart uses raster-safe visual primitives on scaled 4K displays", () => {
  assert.match(chart, /vertLines:\s*\{\s*visible:\s*false\s*\}/)
  assert.match(chart, /horzLines:\s*\{\s*visible:\s*false\s*\}/)
  assert.match(chart, /lineWidth:\s*2/)
  assert.match(chart, /priceLineVisible:\s*false/)
  assert.doesNotMatch(chart, /vertLines:\s*\{\s*color:/)
  assert.doesNotMatch(chart, /horzLines:\s*\{\s*color:/)
})

test("Wyckoff chart caps the physical raster viewport before large-window flicker threshold", () => {
  assert.match(chart, /data-wyckoff-chart-raster-viewport/)
  assert.match(chart, /max-w-\[1360px\]/)
  assert.match(chart, /\[contain:paint\]/)
})

test("Wyckoff chart disables every zoom path while preserving drag panning", () => {
  assert.match(chart, /handleScroll:\s*\{[\s\S]*mouseWheel:\s*false[\s\S]*pressedMouseMove:\s*true/)
  assert.match(chart, /handleScale:\s*false/)
  assert.doesNotMatch(chart, /addEventListener\("wheel"|removeEventListener\("wheel"/)
})

test("Wyckoff chart resize remains rAF-batched without autoSize or full-surface swapping", () => {
  assert.doesNotMatch(page, /<WyckoffChartDashboard\s+key=|key=\{ticker\}|key=\{unified\.ticker\}/)
  assert.match(chart, /new ResizeObserver/)
  assert.match(chart, /requestAnimationFrame/)
  assert.match(chart, /currentChart\.applyOptions/)
  assert.doesNotMatch(chart, /autoSize:\s*true/)
  assert.match(chartRuntime, /applyOptions\(options: Record<string, unknown>\)/)
})

test("Wyckoff dashboard avoids large ticker-switch motion ancestors", () => {
  assert.doesNotMatch(dashboard, /LazyMotion|AnimatePresence|motion\/react/)
  assert.doesNotMatch(dashboard, /transition-all|backdrop-blur|backdrop-filter/)
  assert.match(dashboard, /<WyckoffLightweightChart/)
})

test("canonical shell renders first and heavy infographic hydration is deferred", () => {
  assert.match(page, /getCanonicalUniverse/)
  assert.match(page, /<WyckoffDeferredDashboard/)
  assert.match(deferred, /dynamic\(/)
  assert.match(deferred, /ssr:\s*false/)
  assert.match(deferred, /requestAnimationFrame/)
  assert.match(deferred, /AbortController/)
})

test("company metadata remains selected-ticker only and fail-open", () => {
  assert.match(metadata, /select\("as_of_date"\)/)
  assert.match(metadata, /select\("ticker,company_name,sector,exchange"\)/)
  assert.match(metadata, /\.eq\("is_published", true\)/)
  assert.match(metadata, /return new Map\(\)/)
  assert.match(unifiedData, /getWyckoffCompanyMetadata\(supabase, \[ticker\]\)/)
  assert.doesNotMatch(page, /getWyckoffCompanyMetadata/)
})
