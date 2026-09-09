import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-165 turns capital allocation into a progressive War Room without moving calculation ownership", () => {
  const allocation = source("components/portfolio/portfolio-capital-allocation.tsx")
  const page = source("components/portfolio/portfolio-page.tsx")
  const nav = source("components/portfolio/revamp/war-room-stage-nav.tsx")

  assert.match(allocation, /WarRoomStageNav/)
  assert.match(allocation, /useState<WarRoomStage>\("capacity"\)/)
  for (const label of ["Quân lực", "Dàn quân", "Lệnh dự kiến", "Simulation"]) {
    assert.match(nav, new RegExp(label))
  }

  assert.match(allocation, /PortfolioAllocationAdvisor/)
  assert.match(allocation, /PortfolioCurrentState/)
  assert.match(allocation, /TradeSizeAdvisor/)
  assert.match(allocation, /CombinedPortfolioSimulation/)
  assert.match(allocation, /manualAccountEquityVnd/)
  assert.match(allocation, /plannedTrades/)
  assert.match(allocation, /useRiskSizingContext\(activePortfolioId\)/)
  assert.match(allocation, /buildPortfolioAllocationSnapshot/)
  assert.match(allocation, /simulatePlannedTrades/)

  assert.match(page, /Kế hoạch quản trị vốn nâng cao/)
  assert.match(page, /<PortfolioRiskPlan\s+key=\{activePortfolioId\}/)
  assert.doesNotMatch(nav, /fetch\s*\(/)
})
