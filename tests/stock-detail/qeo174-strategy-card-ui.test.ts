import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-174 adds bounded factual stock-card presentation primitives", async () => {
  const metrics = await import("../../components/stock-detail/revamp/stock-card-metrics.ts")
  const stat = source("components/stock-detail/revamp/stock-card-stat.tsx")
  const arena = source("components/stock-detail/revamp/stock-price-arena.tsx")

  assert.equal(metrics.rangePosition(50, 0, 100), 50)
  assert.equal(metrics.rangePosition(-10, 0, 100), 0)
  assert.equal(metrics.rangePosition(120, 0, 100), 100)
  assert.equal(metrics.rangePosition(50, 100, 100), 50)
  assert.equal(metrics.rangePosition(Number.NaN, 0, 100), 50)

  assert.match(stat, /CARD STATS|StockCardStat/)
  assert.match(arena, /PRICE ARENA/)
  assert.match(arena, /Sàn/)
  assert.match(arena, /Tham chiếu/)
  assert.match(arena, /Trần/)
  assert.doesNotMatch(`${stat}\n${arena}`, /rarity|legendary|power score|attack|defense/i)
})

test("QEO-174 turns StockCompanyHeader into a reduced-motion strategy-card hero", () => {
  const header = source("components/stock-detail/stock-company-header.tsx")

  assert.match(header, /data-qeo174-strategy-card/)
  assert.match(header, /STOCK CARD/)
  assert.match(header, /CARD STATS/)
  assert.match(header, /StockPriceArena/)
  assert.match(header, /StockCardStat/)
  assert.match(header, /useReducedMotion/)
  assert.match(header, /rank/)
  assert.match(header, /P\/E/)
  assert.match(header, /P\/B/)
  assert.match(header, /ROE/)
  assert.match(header, /EPS/)
  assert.match(header, /Bookmark/)
  assert.match(header, /Share2/)
  assert.doesNotMatch(header, /rarity|legendary|power score/i)
})

test("QEO-174 keeps workstation orchestration and adds only presentation atmosphere", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")

  assert.match(workstation, /data-qeo174-workstation/)
  assert.match(workstation, /StockAiSidebar/)
  assert.match(workstation, /StockCompanyHeader/)
  assert.match(workstation, /StockTradingViewChartData/)
  assert.match(workstation, /StockTabsPanel/)
  assert.match(workstation, /StockWatchlistSidebar/)
  assert.match(workstation, /setIsChartMaximized/)
  assert.match(workstation, /handleSelectTicker/)
})
