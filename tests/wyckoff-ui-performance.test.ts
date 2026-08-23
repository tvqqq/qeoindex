import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const dashboard = readFileSync("components/insights/wyckoff-chart-dashboard.tsx", "utf8")
const page = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const unifiedData = readFileSync("lib/wyckoff-unified-data.ts", "utf8")
const metadata = readFileSync("lib/wyckoff-company-metadata.ts", "utf8")

test("Wyckoff header exposes company identity and keeps timeframe controls inside chart toolbar", () => {
  assert.match(dashboard, /companyName\?: string/)
  assert.match(dashboard, /function SymbolIdentity/)
  assert.match(dashboard, /\{companyName\}/)
  assert.match(dashboard, /data-wyckoff-chart-toolbar/)
  assert.match(dashboard, /aria-label="Khung thời gian biểu đồ"/)

  const headerStart = dashboard.indexOf("<header")
  const headerEnd = dashboard.indexOf("</header>", headerStart)
  const headerSource = dashboard.slice(headerStart, headerEnd)
  assert.doesNotMatch(headerSource, /studies\.map/)
})

test("Wyckoff watchlist preserves readable company labels without eager route prefetch", () => {
  assert.match(dashboard, /Mã · Công ty \/ Ngành/)
  assert.match(dashboard, /stock\.companyName/)
  assert.match(dashboard, /Tìm mã, công ty hoặc ngành/)
  assert.match(dashboard, /prefetch=\{false\}/)
  assert.match(dashboard, /useDeferredValue\(query\)/)
  assert.match(dashboard, /memo\(function WatchlistRow/)
  assert.match(dashboard, /content-visibility:auto/)
})

test("Wyckoff motion is bounded to symbol identity and never wraps the chart canvas", () => {
  assert.match(dashboard, /LazyMotion/)
  assert.match(dashboard, /duration: 0\.18/)
  assert.match(dashboard, /initial=\{reduceMotion \? false : \{ opacity: 0, x: 10 \}\}/)
  assert.doesNotMatch(dashboard, /AnimatePresence/)
  assert.doesNotMatch(dashboard, /transition-all/)
  assert.doesNotMatch(dashboard, /backdrop-blur|backdrop-filter|drop-shadow/)
  assert.doesNotMatch(dashboard, /filter:\s*/)

  const symbolMotionEnd = dashboard.indexOf("const WatchlistRow")
  const chartIndex = dashboard.indexOf("<WyckoffLightweightChart")
  assert.ok(symbolMotionEnd > 0 && chartIndex > symbolMotionEnd, "chart must stay outside the bounded symbol motion component")
})

test("Wyckoff company metadata stays lean and fail-open for presentation labels", () => {
  assert.match(metadata, /select\("as_of_date"\)/)
  assert.match(metadata, /select\("ticker,company_name,sector,exchange"\)/)
  assert.match(metadata, /\.eq\("is_published", true\)/)
  assert.match(metadata, /\.limit\(1\)/)
  assert.match(metadata, /return new Map\(\)/)
  assert.match(unifiedData, /getWyckoffCompanyMetadata/)
  assert.match(page, /getWyckoffCompanyMetadata/)
})
