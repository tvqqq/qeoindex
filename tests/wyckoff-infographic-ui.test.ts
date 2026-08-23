import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const infographic = readFileSync("components/insights/wyckoff-infographic-dashboard.tsx", "utf8")
const chart = readFileSync("components/insights/wyckoff-lightweight-chart.tsx", "utf8")
const unified = readFileSync("lib/wyckoff-unified-data.ts", "utf8")

test("standalone Wyckoff page routes to the infographic dashboard", () => {
  assert.match(page, /WyckoffInfographicDashboard/)
  assert.match(page, /dataSource="Supabase unified"/)
  assert.doesNotMatch(page, /return <WyckoffChartDashboard/)
})

test("Wyckoff structure lab uses Plus Jakarta and shadcn primitives", () => {
  assert.match(infographic, /font-ticker/)
  assert.match(infographic, /const TYPE =/)
  assert.match(infographic, /display:/)
  assert.match(infographic, /section:/)
  assert.match(infographic, /value:/)
  assert.match(infographic, /body:/)
  assert.match(infographic, /meta:/)
  assert.match(infographic, /@\/components\/ui\/card/)
  assert.match(infographic, /@\/components\/ui\/badge/)
  assert.match(infographic, /@\/components\/ui\/button/)
  assert.match(infographic, /@\/components\/ui\/input/)
  assert.doesNotMatch(infographic, /font-mono/)
  assert.doesNotMatch(infographic, /text-\[(?:9|10|11)px\]/)
  assert.match(chart, /--font-plus-jakarta-sans/)
})

test("standalone Wyckoff keeps only structure, levels, events and price-volume evidence", () => {
  assert.match(infographic, /Cấu trúc Wyckoff hiện tại/)
  assert.match(infographic, /Vùng giá then chốt/)
  assert.match(infographic, /Wyckoff events & evidence/)
  assert.match(infographic, /Price × Volume × Wyckoff events/)
  assert.match(infographic, /Break → Hold → Test → Follow-through/)
  assert.match(infographic, /RelVol/)
  assert.match(infographic, /showIntelligence=\{false\}/)
  assert.match(infographic, /showScenarios=\{false\}/)
  assert.doesNotMatch(infographic, /RSI 14|MA20|MA50|MA200/)
  assert.doesNotMatch(infographic, /ProbabilityBar|Bull \{|Base \{|Bear \{|Conditional target|Kịch bản theo thời gian|OutlookBoard/)
})

test("multi-timeframe module replaces forecast cards with Wyckoff structure alignment", () => {
  assert.match(infographic, /Multi-timeframe Wyckoff structure/)
  assert.match(infographic, /1H → 1M/)
  assert.match(infographic, /rangePosition\(study\)/)
  assert.match(infographic, /latestStudyEvent\(study\)/)
  assert.doesNotMatch(infographic, /outlooks\.map|dominantScenario|probabilitySegments/)
})

test("Wyckoff watchlist is compact and event-first", () => {
  assert.match(infographic, /WATCHLIST_GRID_CLASS = "grid-cols-\[70px_88px_minmax\(0,1fr\)\]"/)
  assert.match(infographic, />Mã<\/div><div className="text-right">Phase<\/div><div className="text-right">Event<\/div>/)
  assert.match(infographic, /placeholder="Tìm mã, pha, event\.\.\."/)
  assert.match(infographic, /watchlistEvent\(stock\)/)
  assert.match(unified, /latestSnapshotEvent/)
  assert.match(unified, /latestEvent: latestSnapshotEvent\(row\)/)
})

test("structure-only mode keeps the existing persistent lightweight chart surface", () => {
  assert.match(infographic, /<WyckoffLightweightChart/)
  assert.match(chart, /showScenarios = true/)
  assert.match(chart, /if \(showScenarios\)/)
  assert.doesNotMatch(infographic, /LazyMotion|AnimatePresence|motion\/react/)
  assert.doesNotMatch(infographic, /backdrop-blur|backdrop-filter/)
})
