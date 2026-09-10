import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("QEO-134 market index cards move below the Bubbles heading as one desktop row", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const bubblesHeading = dashboard.indexOf("Bubbles · Bản đồ giao dịch thị trường")
  const indexStrip = dashboard.indexOf("data-market-index-strip")
  const marketBubbles = dashboard.indexOf("<MarketBubbles")
  const intelligencePanel = dashboard.indexOf("function MarketIntelligencePanel")

  assert.ok(bubblesHeading >= 0, "Bubbles heading must exist")
  assert.ok(indexStrip > bubblesHeading, "market index strip must render after the Bubbles heading")
  assert.ok(indexStrip < marketBubbles, "market index strip must render before the bubbles visualization")
  assert.ok(indexStrip < intelligencePanel, "market index strip must no longer be owned by MarketIntelligencePanel")
  assert.match(dashboard, /data-market-index-strip[^>]*className="[^"]*xl:grid-cols-4/)
  assert.doesNotMatch(dashboard, /data-market-index-column/, "the old market-intelligence index column must be removed")
})

test("QEO-134 market intelligence replaces the old index column with sentiment history", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")

  assert.match(dashboard, /data-market-intelligence-overview-row[^>]*className="[^"]*xl:grid-cols-3[^"]*xl:items-stretch/)
  assert.match(dashboard, /data-market-summary-column[^>]*className="[^"]*h-full/)
  assert.match(dashboard, /data-market-sentiment-column[^>]*className="[^"]*h-full[^"]*\[&>\*\]:h-full/)
  assert.match(dashboard, /data-market-sentiment-history-column[^>]*className="[^"]*h-full[^"]*\[&>\*\]:h-full/)
  assert.match(dashboard, /data-market-sentiment-column[\s\S]*<MarketSentimentCard data=\{data\}/)
  assert.match(dashboard, /data-market-sentiment-history-column[\s\S]*<MarketSentimentHistoryCard data=\{data\}/)
  assert.doesNotMatch(dashboard, /xl:grid-cols-\[35fr_65fr\]/, "the previous two-column pulse/index row must remain removed")
})

test("QEO-134 sentiment and index surfaces do not expose provider names", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const healthView = read("components/insights/market-health-view.tsx")
  const bubblesStart = dashboard.indexOf("Bubbles · Bản đồ giao dịch thị trường")
  const intelligenceStart = dashboard.indexOf("Nhịp đập thị trường & Sức khoẻ thị trường")
  const sectorsStart = dashboard.indexOf("id=\"market-sectors-title\"")
  const relevantDashboard = dashboard.slice(Math.min(bubblesStart, intelligenceStart), sectorsStart)

  assert.doesNotMatch(relevantDashboard, /nguồn KFSP|TOPI/i)
  assert.doesNotMatch(healthView, /KFSP chưa trả chỉ báo tâm lý|TOPI/i)
})

test("QEO-134 market sentiment adapter uses the verified VN-Index endpoints without KFSP fallback", () => {
  const provider = read("modules/research/market-insight/topi-sentiment.ts")
  const insightsData = read("modules/research/insights/data.ts")

  assert.match(provider, /https:\/\/apiclient\.topi\.vn\/api-web/)
  assert.match(provider, /TOPI_TARGET_VNINDEX = 0/)
  assert.match(provider, /postTopi\("GetFGIndex", \{ Target: TOPI_TARGET_VNINDEX \}/)
  assert.match(provider, /postTopi\("GetFGChart", \{ Target: TOPI_TARGET_VNINDEX, Days: 0 \}/)
  assert.match(insightsData, /fetchTopiMarketSentiment\(\)/)
  assert.match(insightsData, /sentimentScore: sentiment\?\.score \?\? null/)
  assert.match(insightsData, /sentimentHistory: sentiment\?\.history \?\? \[\]/)
})

test("QEO-134 sentiment history filter lives in the widget header", () => {
  const healthView = read("components/insights/market-health-view.tsx")
  const historyCard = healthView.slice(healthView.indexOf("export function MarketSentimentHistoryCard"))

  assert.match(historyCard, /<MarketWidgetChildHeader[\s\S]*title="Lịch sử chỉ báo tâm lý"[\s\S]*actions=\{/)
  assert.match(historyCard, /actions=\{[\s\S]*htmlFor="market-sentiment-history-range"[\s\S]*id="market-sentiment-history-range"/)
  assert.doesNotMatch(historyCard, /<div className="mt-3 flex items-center justify-end gap-2">/)
})

test("QEO-134 sentiment history uses a white line without area fill", () => {
  const healthView = read("components/insights/market-health-view.tsx")
  const historyCard = healthView.slice(healthView.indexOf("export function MarketSentimentHistoryCard"))

  assert.match(historyCard, /<Line[\s\S]*dataKey="value"[\s\S]*stroke="#f8fafc"/)
  assert.doesNotMatch(historyCard, /<Area[\s\S]*dataKey="value"/)
  assert.doesNotMatch(historyCard, /sentimentHistoryGradient/)
})

test("QEO-134 sentiment history hover exposes date score and dynamic sentiment label", () => {
  const healthView = read("components/insights/market-health-view.tsx")

  assert.match(healthView, /function getSentimentHistoryLabel\(score: number\)/)
  assert.match(healthView, /score < 30[\s\S]*Sợ hãi cực độ/)
  assert.match(healthView, /score < 45[\s\S]*Sợ hãi/)
  assert.match(healthView, /score < 56[\s\S]*Trung lập/)
  assert.match(healthView, /score < 71[\s\S]*Tham lam/)
  assert.match(healthView, /Tham lam cực độ/)
  assert.match(healthView, /SentimentHistoryTooltip[\s\S]*getSentimentHistoryLabel\(point\.value\)/)
  assert.match(healthView, /SentimentHistoryTooltip[\s\S]*point\.tradingDate[\s\S]*point\.value/)
})

test("QEO-134 market index cards have explicit borders and roomier padding", () => {
  const dashboard = read("components/insights/market-close-dashboard.tsx")
  const indexTile = dashboard.slice(dashboard.indexOf("function IndexTile"), dashboard.indexOf("function ChartPanel"))

  assert.match(indexTile, /Card className=\{cn\(surface, "[^"]*border border-white\/\[0\.12\][^"]*"\)\}/)
  assert.match(indexTile, /CardContent className="p-4 sm:p-5"/)
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
  assert.match(dashboard, /IndexTile[\s\S]*font-mono text-xs font-black text-slate-200/)
  assert.match(dashboard, /text-\[10px\] text-slate-400/)
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

test("sector stock popup keeps canonical toolbar semantics and delegates table UI", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")
  const rankingTable = read("components/insights/stock-ranking-table.tsx")

  assert.match(sectorPanel, /createPortal/)
  assert.match(sectorPanel, /document\.body/)
  assert.match(sectorPanel, /fixed inset-x-0 bottom-0 top-14/)
  assert.match(sectorPanel, /max-h-\[calc\(100dvh-88px\)\]/)
  assert.match(sectorPanel, /max-w-\[min\(1600px,calc\(100vw-2rem\)\)\]/)

  assert.doesNotMatch(sectorPanel, /modalUniverse|Top 100/, "sector popup must not keep the obsolete Top 100 switch")
  assert.match(sectorPanel, /Tất cả · \{ratings\.length\} mã/)
  assert.match(sectorPanel, /Nguồn KFSP · điểm Qeo/)
  assert.match(sectorPanel, /SelectTrigger aria-label="Lọc theo ngành" className="h-10 w-full min-w-64 border-white\/10 bg-cell px-3 text-sm sm:text-base font-bold text-white hover:bg-white\/\[0\.05\] sm:w-80"/)
  assert.match(sectorPanel, /placeholder="Tìm mã hoặc tên\.\.\."[^>]*className="h-10 border-white\/10 bg-cell pl-9 text-sm sm:text-base text-white placeholder:text-muted focus-visible:border-brand\/50 focus-visible:ring-brand\/20"/)
  assert.match(sectorPanel, /<StockRankingTable\b/)
  assert.match(sectorPanel, /overflow-x-auto/)
  assert.match(rankingTable, /Vốn hóa/)
  assert.match(rankingTable, /className="w-full min-w-\[1400px\] table-fixed font-ticker"/)
  assert.match(rankingTable, /StockLogo symbol=\{row\.ticker\} size=\{36\}/)
  assert.match(rankingTable, /font-ticker text-\[16px\] font-extrabold/)
  assert.match(sectorPanel, /Đóng \(ESC\)/)
  assert.doesNotMatch(sectorPanel, /backdrop-blur/, "ranking popup must stay compositor-safe without backdrop blur")
})

test("QEO-151 leading-sector workspace renders the top six sectors in a three-column desktop grid", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /currentSectors\.filter\(\(sector\) => sector\.averageChangePct != null\)\.slice\(0, 6\)/)
  assert.match(sectorPanel, /data-leading-sector-grid[^>]*className="[^"]*lg:grid-cols-3/)
})

test("QEO-151 each leading-sector card derives its top three stocks from Qeo Composite score", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /function getTopSectorStocks\(/)
  assert.match(sectorPanel, /row\.sector[^\n]*sectorName/)
  assert.match(sectorPanel, /right\.ratingScore - left\.ratingScore/)
  assert.match(sectorPanel, /\.slice\(0, 3\)/)
  assert.match(sectorPanel, /getTopSectorStocks\(ratings, sector\.displayName\)/)
})

test("QEO-151 leading-sector card body renders ticker and Qeo Composite for each top stock", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /data-sector-top-stocks/)
  assert.match(sectorPanel, /topStocks\.map\(\(stock, stockIndex\) =>/)
  assert.match(sectorPanel, /stock\.ticker/)
  assert.match(sectorPanel, /Qeo Composite/)
  assert.match(sectorPanel, /formatNumber\(stock\.ratingScore, 1\)/)
})

test("QEO-151 cards keep the existing header metrics while adding an explicit hover border treatment", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /RS \{formatNumber\(sector\.rsScore, 2\)\}/)
  assert.match(sectorPanel, /formatSigned\(changePct, 2, "%"\)/)
  assert.match(sectorPanel, /GTGD:/)
  assert.match(sectorPanel, /hover:border-(?:cyan|teal)-400\/60/)
})
