import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("market index cards live inside the market-intelligence panel as a compact strip", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const intelligenceHeading = dashboard.indexOf("Nhịp đập thị trường & Sức khoẻ thị trường")
  const indexStrip = dashboard.indexOf("data-market-index-strip")
  const intelligencePanel = dashboard.indexOf("function MarketIntelligencePanel")
  const topLevelPanelCall = dashboard.indexOf("<MarketIntelligencePanel")

  assert.ok(intelligenceHeading >= 0, "market-intelligence heading must exist")
  assert.ok(indexStrip > intelligenceHeading, "compact index strip must render below the market-intelligence heading")
  assert.ok(indexStrip > intelligencePanel, "index strip must be owned by MarketIntelligencePanel")
  assert.doesNotMatch(
    dashboard.slice(0, topLevelPanelCall),
    /indexes\.map\(\(item\) => <IndexTile/,
    "major indexes must no longer render above the market-intelligence panel",
  )
  assert.match(dashboard, /data-market-index-strip[^>]*className="[^"]*grid-cols-2[^"]*xl:grid-cols-4/)
})

test("market intelligence uses a compact 35/65 pulse-to-index workspace", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /data-market-intelligence-grid[^>]*className="[^"]*xl:grid-cols-\[35fr_65fr\]/)
  assert.match(dashboard, /data-market-summary-column/)
  assert.match(dashboard, /data-market-index-column/)
  assert.match(dashboard, /data-market-index-column[\s\S]*grid-cols-2[\s\S]*indexes\.map\(\(item\) => <IndexTile/)
  assert.doesNotMatch(dashboard, /xl:grid-cols-\[7fr_3fr\]/, "the old AI/sentiment 70/30 row must not own the pulse/index layout")
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

test("sector stock popup follows the canonical Top cổ phiếu ranking surface", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /data-stock-ranking-dialog/)
  assert.match(sectorPanel, /max-w-\[1280px\]/)
  assert.match(sectorPanel, /SIGNAL RANKING/)
  assert.match(sectorPanel, /Top cổ phiếu theo Qeo composite/)
  assert.match(sectorPanel, /Supabase live/)
  assert.match(sectorPanel, /Top 100/)
  assert.match(sectorPanel, /Tất cả/)
  assert.match(sectorPanel, /Tìm mã hoặc tên\.\.\./)
  assert.match(sectorPanel, /Đóng \(ESC\)/)
  assert.doesNotMatch(sectorPanel, /backdrop-blur/, "ranking popup must use the same opaque high-performance surface without backdrop blur")
})