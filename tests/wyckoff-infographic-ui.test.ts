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
  assert.match(infographic, /Event Wyckoff — hiểu nhanh/)
  assert.match(infographic, /Giá × Khối lượng × Event Wyckoff/)
  assert.match(infographic, /Phá vùng → Đứng được → Quay lại thử → Đi tiếp/)
  assert.match(infographic, /RelVol/)
  assert.match(infographic, /showIntelligence=\{false\}/)
  assert.match(infographic, /showScenarios=\{false\}/)
  assert.doesNotMatch(infographic, /RSI 14|MA20|MA50|MA200/)
  assert.doesNotMatch(infographic, /ProbabilityBar|Bull \{|Base \{|Bear \{|Conditional target|Kịch bản theo thời gian|OutlookBoard/)
})

test("event explanations use plain Vietnamese while preserving canonical labels", () => {
  assert.match(infographic, /Spring · thủng đáy rồi kéo ngược/)
  assert.match(infographic, /SOS · đang thử bứt lên/)
  assert.match(infographic, /UT \/ UTAD · vượt đỉnh nhưng không giữ được/)
  assert.match(infographic, /SOW · đang thử rơi khỏi nền/)
  assert.match(infographic, /Hiểu đơn giản:/)
  assert.match(infographic, /Nhìn tiếp:/)
  assert.match(infographic, /plainSentence/)
  assert.match(infographic, /Khi nào coi như sai/)
})

test("multi-timeframe module replaces forecast cards with Wyckoff structure alignment", () => {
  assert.match(infographic, /Cấu trúc Wyckoff theo nhiều khung/)
  assert.match(infographic, /ưu tiên 1D và 1W hơn 1H/)
  assert.match(infographic, /rangePosition\(study\)/)
  assert.match(infographic, /latestStudyEvent\(study\)/)
  assert.doesNotMatch(infographic, /outlooks\.map|dominantScenario|probabilitySegments/)
})

test("Wyckoff watchlist shows separate 1H 1D 1W phases and removes Event column", () => {
  assert.match(infographic, /WATCHLIST_GRID_CLASS = "grid-cols-\[54px_repeat\(3,minmax\(0,1fr\)\)\]"/)
  assert.match(infographic, /Phase riêng cho 1H · 1D · 1W/)
  assert.match(infographic, />Mã<\/div><div className="text-center">1H<\/div><div className="text-center text-cyan-400">1D<\/div><div className="text-center">1W<\/div>/)
  assert.match(infographic, /placeholder="Tìm mã hoặc phase\.\.\."/)
  assert.match(infographic, /phaseFor\(stock, "1H"\)/)
  assert.match(infographic, /phaseFor\(stock, "1D"\)/)
  assert.match(infographic, /phaseFor\(stock, "1W"\)/)
  assert.doesNotMatch(infographic, />Event<\/div>/)
  assert.doesNotMatch(infographic, /Mã · Phase · Event/)
  assert.match(unified, /\.in\("timeframe", \["1H", "1D", "1W"\]\)/)
  assert.match(unified, /phase1H: row1H\?\.phase/)
  assert.match(unified, /phase1D: row1D\?\.phase/)
  assert.match(unified, /phase1W: row1W\?\.phase/)
})

test("structure-only mode keeps the existing persistent lightweight chart surface", () => {
  assert.match(infographic, /<WyckoffLightweightChart/)
  assert.match(chart, /showScenarios = true/)
  assert.match(chart, /if \(showScenarios\)/)
  assert.doesNotMatch(infographic, /LazyMotion|AnimatePresence|motion\/react/)
  assert.doesNotMatch(infographic, /backdrop-blur|backdrop-filter/)
})
