import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("sector popup and Top cổ phiếu share one canonical ranking table implementation", () => {
  const sharedPath = path.resolve("components/insights/stock-ranking-table.tsx")
  assert.ok(fs.existsSync(sharedPath), "shared stock-ranking-table.tsx must exist so popup UI cannot drift from canonical Top cổ phiếu")

  const shared = read("components/insights/stock-ranking-table.tsx")
  const sectorPanel = read("components/insights/sector-map-panel.tsx")
  const insights = read("components/insights/insights-dashboard.tsx")

  assert.match(sectorPanel, /<StockRankingTable\b/)
  assert.match(insights, /<StockRankingTable\b/)
  assert.doesNotMatch(sectorPanel, /function PopupSortHead|function PopupRrgBadge/)

  assert.match(shared, /className="w-full min-w-\[1400px\] table-fixed font-ticker"/)
  assert.match(shared, /StockLogo symbol=\{row\.ticker\} size=\{36\}/)
  assert.match(shared, /font-ticker text-\[16px\] font-extrabold/)
  assert.match(shared, /formatMarketCapBillion\(row\.marketCapBillion\)/)
  assert.match(shared, /ScorePill value=\{row\.canslimScore\}/)
  assert.match(shared, /ScorePill value=\{row\.rsShort \?\? row\.scoreComponents\.momentum\}/)
  assert.match(shared, /<RrgBadge value=\{row\.stockRrgState\}/)
  assert.match(shared, /MarketChangePill value=\{row\.changePercent\}/)
})

test("sector popup gives the canonical table enough width instead of compressing score columns", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /max-w-\[min\(1600px,calc\(100vw-2rem\)\)\]/)
  assert.match(sectorPanel, /overflow-x-auto/)
  assert.doesNotMatch(sectorPanel, /max-w-\[1180px\]/)
})
