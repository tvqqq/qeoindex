import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

test("sector popup renders the canonical Top cổ phiếu ranking surface", () => {
  const sharedPath = path.resolve("components/insights/stock-ranking-table.tsx")
  assert.ok(fs.existsSync(sharedPath), "canonical stock-ranking-table.tsx must exist so popup cells are not duplicated locally")

  const shared = read("components/insights/stock-ranking-table.tsx")
  const sectorPanel = read("components/insights/sector-map-panel.tsx")
  const insights = read("components/insights/insights-dashboard.tsx")

  assert.match(sectorPanel, /<StockRankingTable\b/)
  assert.doesNotMatch(sectorPanel, /function PopupSortHead|function PopupRrgBadge/)

  assert.match(shared, /className="w-full min-w-\[1400px\] table-fixed font-ticker"/)
  assert.match(shared, /StockLogo symbol=\{row\.ticker\} size=\{36\}/)
  assert.match(shared, /font-ticker text-\[16px\] font-extrabold/)
  assert.match(shared, /formatMarketCapBillion\(row\.marketCapBillion\)/)
  assert.match(shared, /ScorePill value=\{row\.canslimScore\}/)
  assert.match(shared, /ScorePill value=\{row\.rsShort \?\? row\.scoreComponents\.momentum\}/)
  assert.match(shared, /<RrgBadge value=\{row\.stockRrgState\}/)
  assert.match(shared, /MarketChangePill value=\{row\.changePercent\}/)

  for (const canonicalMarker of [
    "font-ticker text-[16px] font-extrabold",
    "border-white/[0.065] bg-[#07101a]/35",
    "min-w-20 justify-center gap-1 px-1.5 text-xs font-bold",
    "h-8 min-w-13",
  ]) {
    assert.ok(insights.includes(canonicalMarker), `Top cổ phiếu canonical marker is missing: ${canonicalMarker}`)
    assert.ok(shared.includes(canonicalMarker), `sector popup shared surface must match canonical marker: ${canonicalMarker}`)
  }
})

test("sector popup gives the canonical table enough width instead of compressing score columns", () => {
  const sectorPanel = read("components/insights/sector-map-panel.tsx")

  assert.match(sectorPanel, /max-w-\[min\(1600px,calc\(100vw-2rem\)\)\]/)
  assert.match(sectorPanel, /overflow-x-auto/)
  assert.doesNotMatch(sectorPanel, /max-w-\[1180px\]/)
})
