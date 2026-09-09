import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 makes tactical cards the primary holdings presentation without inventing stock semantics", () => {
  const page = source("components/portfolio/portfolio-page.tsx")
  const card = source("components/portfolio/revamp/tactical-position-card.tsx")
  const rail = source("components/portfolio/revamp/position-battle-rail.tsx")
  const grid = source("components/portfolio/revamp/portfolio-position-grid.tsx")

  assert.match(page, /PortfolioPositionGrid/)
  assert.match(page, /Chi tiết đội hình/)
  assert.match(page, /PortfolioPositionsTable/)
  assert.match(card, /\+ Lệnh/)
  assert.match(card, /MISSING_STOP|THIẾU STOP/)
  assert.match(rail, /STOP/)
  assert.match(rail, /CURRENT/)
  assert.match(rail, /TARGET/)
  assert.doesNotMatch(rail, /probability|xác suất|success rate/i)
  assert.doesNotMatch(card, /rarity|conviction|tấn công|phòng thủ|mạnh|yếu/i)

  assert.match(grid, /currentPrices\[pos\.ticker\] \?\? pos\.avgCost/)
  assert.match(grid, /currentPrice \* pos\.openQty/)
  assert.match(grid, /\(currentPrice - pos\.avgCost\) \* pos\.openQty/)
  assert.doesNotMatch(grid, /fetch\s*\(/)
})
