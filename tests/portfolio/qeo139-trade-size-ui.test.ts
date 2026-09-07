import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const calculatorPath = "components/portfolio/risk-sizing/trade-size-calculator.tsx"
const tooltipPath = "components/portfolio/risk-sizing/risk-metric-tooltip.tsx"
const allocationPath = "components/portfolio/portfolio-capital-allocation.tsx"
const pagePath = "components/portfolio/portfolio-page.tsx"

function read(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

test("stop-first Trade Size surface exposes canonical McDowell/QeoIndex terms", () => {
  const source = read(calculatorPath)
  for (const label of [
    "Account Equity",
    "Risk per Trade",
    "Risk Amount",
    "Planned Entry",
    "Initial Stop",
    "Risk per Share",
    "Estimated Commission",
    "Slippage Allowance",
    "Trade Size",
    "Position Value",
    "Active Risk",
    "Max Active Risk",
    "Remaining Risk Budget",
  ]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing ${label}`)
  }
})

test("calculator is API-backed, deterministic, tooltip-driven and never Supabase-direct", () => {
  const source = read(calculatorPath)
  assert.match(source, /\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing/)
  assert.match(source, /calculateTradeSize/)
  assert.match(source, /projectActiveRisk/)
  assert.match(source, /RiskMetricTooltip/)
  assert.doesNotMatch(source, /createClient|supabase\.|\.from\(/)
})

test("legacy fixed-stop assumptions and unsafe risk claims are removed from the allocation surface", () => {
  const source = `${read(allocationPath)}\n${read(calculatorPath)}`
  assert.doesNotMatch(source, /triệt tiêu hoàn toàn nguy cơ/i)
  assert.doesNotMatch(source, /dealStopLossPct|7\.0.*Stoploss/i)
  assert.doesNotMatch(source, /% Cắt lỗ deal tiếp theo/i)
})

test("draft sizing state cannot leak across portfolio switches", () => {
  const page = read(pagePath)
  assert.match(page, /<PortfolioCapitalAllocation[\s\S]*?key=\{activePortfolioId\s*\?\?\s*""\}/)
})

test("RiskMetricTooltip resolves shared terminology instead of duplicating formulas", () => {
  const tooltip = read(tooltipPath)
  assert.match(tooltip, /RISK_SIZING_TERMS/)
  assert.match(tooltip, /Tooltip/)
  assert.doesNotMatch(tooltip, /Risk Amount\s*=|Trade Size\s*=/)
})

test("stop-first guidance states stop provenance and execution risks without guarantees", () => {
  const source = read(calculatorPath)
  assert.match(source, /support|resistance/i)
  assert.match(source, /volatility|price activity/i)
  assert.match(source, /trading-system|system rule/i)
  assert.match(source, /trailing stop/i)
  assert.match(source, /gap/i)
  assert.match(source, /liquidity/i)
  assert.match(source, /overnight/i)
  assert.match(source, /slippage/i)
  assert.doesNotMatch(source, /guarantee|bảo đảm.*không.*thua|không thể cháy/i)
})

test("projected risk panel fails closed when open Trade risk is unknown", () => {
  const source = read(calculatorPath)
  assert.match(source, /Risk Added by Planned Trade/)
  assert.match(source, /Projected Active Risk/)
  assert.match(source, /Risk Unknown/)
  assert.match(source, /unknownRiskTradeCount/)
  assert.doesNotMatch(source, /unknownRiskTradeCount[^\n]{0,80}within plan/i)
})
