import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const page = source("app/insights/wyckoff/page.tsx")
const deferred = source("components/insights/wyckoff-deferred-dashboard.tsx")
const dashboard = source("components/insights/wyckoff-daily-weekly-dashboard.tsx")
const chart = source("components/insights/wyckoff-lightweight-chart.tsx")
const chartRuntime = source("modules/shared/charts/lightweight-charts-runtime.ts")
const tickerApi = source("app/api/insights/wyckoff/route.ts")
const unifiedData = source("modules/wyckoff/unified-data.ts")
const metadata = source("modules/wyckoff/company-metadata.ts")

test("Wyckoff header uses canonical stock identity and no legacy back row", () => {
  assert.match(dashboard, /import \{ StockIdentity \}/)
  assert.match(dashboard, /<StockIdentity/)
  assert.match(dashboard, /ticker=\{tickerData\.ticker\}/)
  assert.doesNotMatch(dashboard, /ArrowLeft|Quay lại Rating|data-wyckoff-back-row/)
})

test("watchlist is ticker-first and bounded to 1D and 1W", () => {
  assert.match(dashboard, /grid-cols-\[72px_1fr_1fr\]/)
  assert.match(dashboard, /phaseFor\(stock, "1D"\)/)
  assert.match(dashboard, /phaseFor\(stock, "1W"\)/)
  assert.doesNotMatch(dashboard, /phase1H|phaseFor\(stock, "1H"\)|"4H"|"1M"/)
})

test("ticker switching is lightweight and keeps the current page surface", () => {
  assert.match(dashboard, /fetch\(`\/api\/insights\/wyckoff\?ticker=/)
  assert.match(dashboard, /window\.history\.replaceState/)
  assert.doesNotMatch(dashboard, /router\.refresh\(\)|window\.history\.pushState|useRouter/)
  assert.doesNotMatch(dashboard, /LazyMotion|AnimatePresence|motion\/react/)
})

test("canonical shell renders first and heavy dashboard hydration is deferred", () => {
  assert.match(page, /getCanonicalUniverse/)
  assert.match(page, /<WyckoffDeferredDashboard/)
  assert.match(deferred, /dynamic\(/)
  assert.match(deferred, /ssr:\s*false/)
  assert.match(deferred, /requestAnimationFrame/)
  assert.match(deferred, /AbortController/)
  assert.match(deferred, /mode=watchlist/)
})

test("Wyckoff ticker endpoint is authenticated and canonical-universe scoped", () => {
  assert.match(tickerApi, /requireApiUser/)
  assert.match(tickerApi, /getCanonicalUniverse/)
  assert.match(tickerApi, /canonical\.stocks\.find/)
  assert.match(tickerApi, /getUnifiedWyckoffTickerData/)
  assert.match(tickerApi, /Cache-Control/)
  assert.match(unifiedData, /export async function getUnifiedWyckoffTickerData/)
})

test("chart loading remains visual-only and compositor-safe", () => {
  assert.match(chart, /loading = false/)
  assert.match(chart, /<AiLoader/)
  assert.match(chart, /showLabel=\{false\}/)
  assert.match(chart, /compositorSafe/)
  assert.match(chart, /\[contain:layout_paint\]/)
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

test("Wyckoff chart uses raster-safe primitives on scaled displays", () => {
  assert.match(chart, /vertLines:\s*\{\s*visible:\s*false\s*\}/)
  assert.match(chart, /horzLines:\s*\{\s*visible:\s*false\s*\}/)
  assert.match(chart, /priceLineVisible:\s*false/)
  assert.doesNotMatch(chart, /vertLines:\s*\{\s*color:/)
  assert.doesNotMatch(chart, /horzLines:\s*\{\s*color:/)
})

test("Wyckoff chart caps raster viewport and disables zoom while preserving drag panning", () => {
  assert.match(chart, /data-wyckoff-chart-raster-viewport/)
  assert.match(chart, /max-w-\[1360px\]/)
  assert.match(chart, /\[contain:paint\]/)
  assert.match(chart, /handleScroll:\s*\{[\s\S]*mouseWheel:\s*false[\s\S]*pressedMouseMove:\s*true/)
  assert.match(chart, /handleScale:\s*false/)
})

test("Wyckoff chart resize remains rAF-batched without autoSize", () => {
  assert.doesNotMatch(page, /<WyckoffChartDashboard\s+key=|key=\{ticker\}|key=\{unified\.ticker\}/)
  assert.match(chart, /new ResizeObserver/)
  assert.match(chart, /requestAnimationFrame/)
  assert.match(chart, /currentChart\.applyOptions/)
  assert.doesNotMatch(chart, /autoSize:\s*true/)
  assert.match(chartRuntime, /applyOptions\(options: Record<string, unknown>\)/)
})

test("Daily Weekly dashboard avoids large motion/compositor ancestors", () => {
  assert.doesNotMatch(dashboard, /LazyMotion|AnimatePresence|motion\/react/)
  assert.doesNotMatch(dashboard, /transition-all|backdrop-blur|backdrop-filter/)
  assert.match(dashboard, /<WyckoffLightweightChart/)
})

test("company metadata remains selected-ticker only and fail-open", () => {
  assert.match(metadata, /select\("as_of_date"\)/)
  assert.match(metadata, /select\("ticker,company_name,sector,exchange"\)/)
  assert.match(metadata, /\.eq\("is_published", true\)/)
  assert.match(metadata, /return new Map\(\)/)
  assert.match(unifiedData, /getWyckoffCompanyMetadata\(supabase, \[ticker\]\)/)
  assert.doesNotMatch(page, /getWyckoffCompanyMetadata/)
})
