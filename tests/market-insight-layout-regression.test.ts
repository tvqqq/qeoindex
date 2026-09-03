import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("market index cards live inside the market-intelligence panel as a compact 2x2 grid", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const intelligenceHeading = dashboard.indexOf("Nhịp đập thị trường & Sức khoẻ thị trường")
  const indexStrip = dashboard.indexOf("data-market-index-strip")
  const intelligencePanel = dashboard.indexOf("function MarketIntelligencePanel")
  const topLevelPanelCall = dashboard.indexOf("<MarketIntelligencePanel")

  assert.ok(intelligenceHeading >= 0, "market-intelligence heading must exist")
  assert.ok(indexStrip > intelligenceHeading, "compact index grid must render below the market-intelligence heading")
  assert.ok(indexStrip > intelligencePanel, "index grid must be owned by MarketIntelligencePanel")
  assert.doesNotMatch(
    dashboard.slice(0, topLevelPanelCall),
    /indexes\.map\(\(item\) => <IndexTile/,
    "major indexes must no longer render above the market-intelligence panel",
  )
  assert.match(dashboard, /data-market-index-strip[^>]*className="[^"]*grid-cols-2/)
  assert.doesNotMatch(dashboard, /data-market-index-strip[^>]*xl:grid-cols-4/, "right-side index workspace must remain a 2x2 grid")
})

test("market intelligence uses one equal-height three-column overview row", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /data-market-intelligence-overview-row[^>]*className="[^"]*xl:grid-cols-3[^"]*xl:items-stretch/)
  assert.match(dashboard, /data-market-summary-column[^>]*className="[^"]*h-full/)
  assert.match(dashboard, /data-market-sentiment-column[^>]*className="[^"]*h-full[^"]*\[&>\*\]:h-full/)
  assert.match(dashboard, /data-market-index-column[^>]*className="[^"]*h-full/)
  assert.match(dashboard, /data-market-sentiment-column[\s\S]*<MarketSentimentCard data=\{data\}/)
  assert.match(dashboard, /data-market-index-column[\s\S]*grid-cols-2[\s\S]*indexes\.map\(\(item\) => <IndexTile/)
  assert.doesNotMatch(dashboard, /xl:grid-cols-\[35fr_65fr\]/, "the previous two-column pulse/index row must be removed")
})

test("KFSP distribution-day guidance replaces foreign flow without breaking equal stat rows", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /function getDistributionDayGuidance\(/)
  assert.match(dashboard, /days <= 2[\s\S]*Chưa cần hành động/)
  assert.match(dashboard, /days === 3[\s\S]*Bắt đầu quan sát kỹ hơn/)
  assert.match(dashboard, /days === 4[\s\S]*Tìm kiếm tín hiệu bán/)
  assert.match(dashboard, /Ưu tiên phòng thủ/)
  assert.match(dashboard, /data-market-summary-stats[^>]*className="[^"]*auto-rows-fr/)
  assert.match(dashboard, /<PulseStat label="Ngày phân phối"[^>]*dailySummary\.distributionCount/)
  assert.match(dashboard, /<PulseStat label="Hành động"[^>]*distributionGuidance\.message/)
  assert.doesNotMatch(dashboard, /<PulseStat label="Khối ngoại"/)
})

test("market AI surface renders only succeeded conclusion content with an AI analysis icon", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /BrainCircuit/)
  assert.match(dashboard, /marketAiConclusion\?\.status === "succeeded" &&/)
  assert.match(dashboard, /data-market-ai-conclusion/)
  assert.match(dashboard, /<BrainCircuit className="size-5"/)
  assert.match(dashboard, /marketAiConclusion\.payload\?\.headline/)
  assert.match(dashboard, /marketAiConclusion\.payload\?\.conclusion/)
  assert.doesNotMatch(dashboard, /Tổng hợp định lượng/)
  assert.doesNotMatch(dashboard, /Tóm lược định lượng, không phải AI/)
  assert.doesNotMatch(dashboard, /Chưa có AI conclusion|Chưa có market AI conclusion/)
  assert.doesNotMatch(dashboard, /evidenceHash|asOf \{formatTime\(marketAiConclusion/)
})

test("risk and valuation stay inside market intelligence while redundant history panels are removed", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /data-market-health-embedded[\s\S]*<MarketHealthView data=\{data\} history=\{history\}/)
  assert.doesNotMatch(dashboard, /MarketHistoryChart|MarketHistoryFlowChart/)
  assert.doesNotMatch(dashboard, /Tâm lý, rủi ro và MA20|Dòng tiền theo phiên/)
  assert.doesNotMatch(dashboard, /Dữ liệu tổng quan phiên/)
  assert.doesNotMatch(dashboard, /id="market-history-title"/)
})

test("sector workspace removes the redundant market-pulse marketing heading", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.doesNotMatch(dashboard, /Market pulse & cash flow/)
  assert.doesNotMatch(dashboard, /title="Nhóm ngành đang dẫn nhịp"/)
  assert.match(dashboard, /<h2 id="market-sectors-title" className="sr-only">Ngành & dòng tiền<\/h2>/)
})

test("the three highlighted section headings share one typography contract", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const sectorPanel = read("components/insights/sector-map-panel.tsx")
  const insights = read("components/insights/insights-dashboard.tsx")

  assert.match(sectorPanel, /function SectorPanelHeading\(/)
  assert.ok((sectorPanel.match(/<SectorPanelHeading/g) || []).length >= 2, "both sector blocks must reuse SectorPanelHeading")
  assert.match(dashboard, /data-market-heading-typography/)
  assert.match(dashboard, /\[data-market-sector-workspace\] p\.font-mono \+ h3/)
  assert.match(dashboard, /#top-stocks-title/)
  assert.match(dashboard, /font-size:\s*1\.25rem/)
  assert.match(dashboard, /font-size:\s*1\.5rem/)
  assert.match(insights, /id="top-stocks-title"/)
})

test("gray supporting text in the refined market workspace is larger and higher contrast", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /PulseStat[\s\S]*text-xs font-medium text-slate-300/)
  assert.match(dashboard, /text-\[10px\] text-slate-400/)
  assert.match(dashboard, /text-\[11px\] font-mono text-slate-400/)
  assert.match(dashboard, /text-sm[^"\n]*text-slate-300/)
  assert.doesNotMatch(dashboard, /text-\[8px\] text-slate-600/, "index metadata must no longer use tiny low-contrast gray text")
})

test("sector rotation matrix is collapsed by default and reuses the same heading primitive", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /function SectorPanelHeading\(/)
  assert.ok((sectorPanel.match(/<SectorPanelHeading/g) || []).length >= 2, "both sector blocks must reuse SectorPanelHeading")
  assert.match(sectorPanel, /<details[^>]*data-sector-rotation-matrix[^>]*className="group[^"]*"/)
  assert.match(sectorPanel, /<summary[^>]*data-sector-rotation-summary/)
  assert.doesNotMatch(sectorPanel, /<details[^>]*data-sector-rotation-matrix[^>]*\sopen(?:=|\s|>)/, "matrix must be collapsed by default")
})

test("leading-sector RS badge is formatted to exactly two decimals", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /RS \{formatNumber\(sector\.rsScore, 2\)\}/)
  assert.doesNotMatch(sectorPanel, /RS \{sector\.rsScore\}/)
})

test("sector stock popup matches the canonical Top cổ phiếu data and visual contract", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")
  const insights = read("components/insights/insights-dashboard.tsx")

  assert.match(sectorPanel, /createPortal/)
  assert.match(sectorPanel, /document\.body/)
  assert.match(sectorPanel, /fixed inset-x-0 bottom-0 top-14/)
  assert.match(sectorPanel, /max-h-\[calc\(100dvh-88px\)\]/)
  assert.match(sectorPanel, /max-w-\[1180px\]/)

  assert.doesNotMatch(sectorPanel, /modalUniverse|Top 100/, "sector popup must not keep the obsolete Top 100 switch")
  assert.match(sectorPanel, /Tất cả · \{ratings\.length\} mã/)
  assert.match(sectorPanel, /Nguồn KFSP · điểm Qeo/)
  assert.match(sectorPanel, /SelectTrigger aria-label="Chọn ngành" className="h-10 w-full min-w-64 border-white\/10 bg-cell px-3 text-sm sm:text-base font-bold text-white hover:bg-white\/\[0\.05\] sm:w-80"/)
  assert.match(sectorPanel, /placeholder="Tìm mã hoặc tên\.\.\."[^>]*className="h-10 border-white\/10 bg-cell pl-9 text-sm sm:text-base text-white placeholder:text-muted focus-visible:border-brand\/50 focus-visible:ring-brand\/20"/)

  assert.match(sectorPanel, /className="w-full table-fixed font-ticker"/)
  assert.match(sectorPanel, /Vốn hóa/)
  assert.match(sectorPanel, /formatMarketCapBillion\(stock\.marketCapBillion\)/)
  assert.match(sectorPanel, /StockLogo symbol=\{stock\.ticker\} size=\{36\}/)
  assert.match(sectorPanel, /font-ticker text-\[16px\] font-extrabold/)
  assert.match(sectorPanel, /Đóng \(ESC\)/)

  for (const canonicalClass of [
    "h-10 w-full min-w-64 border-white/10 bg-cell px-3 text-sm sm:text-base font-bold text-white hover:bg-white/[0.05] sm:w-80",
    "h-10 border-white/10 bg-cell pl-9 text-sm sm:text-base text-white placeholder:text-muted focus-visible:border-brand/50 focus-visible:ring-brand/20",
    "w-full table-fixed font-ticker",
  ]) {
    assert.ok(insights.includes(canonicalClass), `canonical Top cổ phiếu must retain shared class: ${canonicalClass}`)
    assert.ok(sectorPanel.includes(canonicalClass), `sector popup must match canonical class: ${canonicalClass}`)
  }

  assert.doesNotMatch(sectorPanel, /backdrop-blur/, "ranking popup must stay compositor-safe without backdrop blur")
})
