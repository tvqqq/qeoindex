import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const dashboard = readFileSync("components/insights/wyckoff-chart-dashboard.tsx", "utf8")
const chart = readFileSync("components/insights/wyckoff-lightweight-chart.tsx", "utf8")
const chartRuntime = readFileSync("lib/lightweight-charts-runtime.ts", "utf8")
const page = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const tickerApi = readFileSync("app/api/insights/wyckoff/route.ts", "utf8")
const unifiedData = readFileSync("lib/wyckoff-unified-data.ts", "utf8")
const metadata = readFileSync("lib/wyckoff-company-metadata.ts", "utf8")
const animatedTabs = readFileSync("components/smoothui/animated-tabs/index.tsx", "utf8")
const aiLoader = readFileSync("components/smoothui/ai-loader/index.tsx", "utf8")
const priceFlow = readFileSync("components/smoothui/price-flow/index.tsx", "utf8")

test("Wyckoff header keeps company identity while Rating is isolated in its own row", () => {
  assert.match(dashboard, /companyName\?: string/)
  assert.match(dashboard, /function SymbolIdentity/)
  assert.match(dashboard, /data-wyckoff-back-row/)
  assert.match(dashboard, /Quay lại Rating/)

  const headerStart = dashboard.indexOf("<header")
  const headerEnd = dashboard.indexOf("</header>", headerStart)
  const headerSource = dashboard.slice(headerStart, headerEnd)
  assert.doesNotMatch(headerSource, /ArrowLeft|>\s*Rating\s*</)
  assert.doesNotMatch(headerSource, /studies\.map/)
})

test("Wyckoff watchlist is ticker-first, larger, and strips company exchange sector decoration", () => {
  const rowStart = dashboard.indexOf("const WatchlistRow")
  const rowEnd = dashboard.indexOf("export function WyckoffChartDashboard", rowStart)
  const rowSource = dashboard.slice(rowStart, rowEnd)

  assert.match(dashboard, />Mã<\/div>/)
  assert.match(dashboard, /placeholder="Tìm mã\.\.\."/)
  assert.match(rowSource, /text-\[15px\]/)
  assert.match(rowSource, /content-visibility:auto/)
  assert.match(rowSource, /<a[\s\S]*href=\{href\}/)
  assert.doesNotMatch(rowSource, /companyName|exchange|stock\.sector|StockLogo/)
  assert.doesNotMatch(rowSource, /<Link|prefetch=/)
  assert.doesNotMatch(dashboard, /Mã · Công ty \/ Ngành|Tìm mã, công ty hoặc ngành/)
})

test("Wyckoff ticker switching is cancellable and latest-click-wins", () => {
  assert.match(dashboard, /TICKER_SWITCH_DEBOUNCE_MS = 60/)
  assert.match(dashboard, /new AbortController\(\)/)
  assert.match(dashboard, /switchAbortRef\.current\?\.abort\(\)/)
  assert.match(dashboard, /switchSequenceRef\.current/)
  assert.match(dashboard, /sequence !== switchSequenceRef\.current/)
  assert.match(dashboard, /fetch\(`\/api\/insights\/wyckoff\?ticker=/)
  assert.match(dashboard, /window\.history\.replaceState\(window\.history\.state, "", url\)/)
  assert.match(dashboard, /startTransition\(\(\) => setTickerData\(nextData\)\)/)
  assert.match(dashboard, /TICKER_CACHE_LIMIT = 8/)
  assert.match(dashboard, /onSelectTicker=\{selectTicker\}/)
  assert.doesNotMatch(dashboard, /router\.refresh\(\)/)
  assert.doesNotMatch(dashboard, /window\.history\.pushState/)
  assert.doesNotMatch(dashboard, /useRouter/)
})

test("Wyckoff ticker endpoint is authenticated and reads only the selected ticker payload", () => {
  assert.match(tickerApi, /requireApiUser/)
  assert.match(tickerApi, /getUnifiedWyckoffTickerData/)
  assert.match(tickerApi, /Cache-Control/)
  assert.match(unifiedData, /export async function getUnifiedWyckoffTickerData/)

  const selectedStart = unifiedData.indexOf("export async function getUnifiedWyckoffTickerData")
  const selectedSource = unifiedData.slice(selectedStart)
  assert.match(selectedSource, /\.eq\("ticker", ticker\)/)
  assert.match(selectedSource, /getWyckoffCompanyMetadata\(supabase, \[ticker\]\)/)
  assert.doesNotMatch(selectedSource, /\.in\("ticker", tickers\)/)
})

test("Wyckoff timeframe uses bounded SmoothUI AnimatedTabs inside chart toolbar", () => {
  assert.match(dashboard, /import \{ AnimatedTabs \}/)
  assert.match(dashboard, /data-wyckoff-chart-toolbar/)
  assert.match(dashboard, /<AnimatedTabs[\s\S]*ariaLabel="Khung thời gian biểu đồ"/)
  assert.match(animatedTabs, /layoutId=/)
  assert.match(animatedTabs, /useReducedMotion/)
  assert.match(animatedTabs, /ArrowRight|ArrowLeft/)
  assert.doesNotMatch(animatedTabs, /transition-all|backdrop-blur|backdrop-filter|filter:/)
})

test("chart loading uses bounded SmoothUI AI loader with stable canvas geometry", () => {
  assert.match(chart, /import \{ AiLoader \}/)
  assert.match(chart, /isInitialLoading/)
  assert.match(chart, /<AiLoader label=/)
  assert.match(chart, /compact/)
  assert.match(chart, /h-\[520px\]/)
  assert.match(chart, /xl:h-\[660px\]/)
  assert.match(chart, /\[contain:layout_paint\]/)
  assert.match(aiLoader, /role="status"/)
  assert.match(aiLoader, /useReducedMotion/)
  assert.match(aiLoader, /compact = false/)
  assert.doesNotMatch(aiLoader, /backdrop-blur|backdrop-filter|filter:/)
})

test("price motion uses SmoothUI PriceFlow only on bounded focal numbers", () => {
  assert.match(dashboard, /import \{ PriceFlow \}/)
  assert.match(dashboard, /<PriceFlow value=\{latest\?\.close/)
  assert.match(dashboard, /<PriceFlow value=\{latest\.open\}/)
  assert.match(dashboard, /<PriceFlow value=\{scenario\.probability\}/)
  assert.match(priceFlow, /useReducedMotion/)
  assert.match(priceFlow, /tabular-nums/)

  const rowStart = dashboard.indexOf("const WatchlistRow")
  const rowEnd = dashboard.indexOf("export function WyckoffChartDashboard", rowStart)
  assert.doesNotMatch(dashboard.slice(rowStart, rowEnd), /PriceFlow/)
})

test("Wyckoff chart double-buffers canvas swaps instead of tearing down the visible chart first", () => {
  assert.match(chart, /activeSlotRef/)
  assert.match(chart, /pendingSlotRef/)
  assert.match(chart, /layer\.style\.visibility = "hidden"/)
  assert.match(chart, /await nextPaint\(\)/)
  assert.match(chart, /layer\.style\.visibility = "visible"/)
  assert.match(chart, /const previousSlot = activeSlotRef\.current/)
  assert.match(chart, /removeSlot\(previousSlot\)/)
  assert.match(chart, /activeSlotRef\.current\?\.key === renderKey/)
  assert.doesNotMatch(chart, /chartRef\.current\?\.remove\(\)/)
  assert.doesNotMatch(chart, /\}, \[loadKey, study, ticker\]\)/)
})

test("Wyckoff navigation and chart lifecycle avoid full workspace remount and resize churn", () => {
  assert.doesNotMatch(page, /<WyckoffChartDashboard\s+key=/)
  assert.doesNotMatch(page, /key=\{ticker\}/)
  assert.doesNotMatch(page, /key=\{unified\.ticker\}/)
  assert.match(chart, /new ResizeObserver/)
  assert.match(chart, /requestAnimationFrame/)
  assert.match(chart, /activeSlotRef\.current\?\.chart\.applyOptions\(\{ width, height \}\)/)
  assert.match(chart, /pendingSlotRef\.current\?\.chart\.applyOptions\(\{ width, height \}\)/)
  assert.doesNotMatch(chart, /autoSize:\s*true/)
  assert.match(chartRuntime, /applyOptions\(options: Record<string, unknown>\)/)
})

test("Wyckoff motion stays bounded away from the chart canvas", () => {
  assert.match(dashboard, /LazyMotion/)
  assert.match(dashboard, /duration: 0\.16/)
  assert.doesNotMatch(dashboard, /AnimatePresence/)
  assert.doesNotMatch(dashboard, /transition-all/)
  assert.doesNotMatch(dashboard, /backdrop-blur|backdrop-filter|drop-shadow/)
  assert.doesNotMatch(dashboard, /filter:\s*/)

  const symbolMotionEnd = dashboard.indexOf("const WatchlistRow")
  const chartIndex = dashboard.indexOf("<WyckoffLightweightChart")
  assert.ok(symbolMotionEnd > 0 && chartIndex > symbolMotionEnd, "chart must stay outside the bounded symbol motion component")
})

test("company metadata is selected-ticker only and remains fail-open", () => {
  assert.match(metadata, /select\("as_of_date"\)/)
  assert.match(metadata, /select\("ticker,company_name,sector,exchange"\)/)
  assert.match(metadata, /\.eq\("is_published", true\)/)
  assert.match(metadata, /return new Map\(\)/)
  assert.match(unifiedData, /getWyckoffCompanyMetadata\(supabase, \[ticker\]\)/)
  assert.match(page, /getWyckoffCompanyMetadata\(auth\.supabase, \[ticker\]\)/)
  assert.doesNotMatch(unifiedData, /getWyckoffCompanyMetadata\(supabase, tickers\)/)
})
