import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

const read = (relativePath: string) => fs.readFileSync(path.resolve(relativePath), "utf8")

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
