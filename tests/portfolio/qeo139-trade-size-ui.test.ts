import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const calculatorPath = "components/portfolio/risk-sizing/trade-size-calculator.tsx"
const tooltipPath = "components/portfolio/risk-sizing/risk-metric-tooltip.tsx"
const allocationPath = "components/portfolio/portfolio-capital-allocation.tsx"
const pagePath = "components/portfolio/portfolio-page.tsx"
const terminologyPath = "modules/portfolio/risk-sizing/terminology.ts"

function read(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("stop-first Trade Size surface exposes canonical McDowell/QeoIndex terms through shared metadata", () => {
  const calculator = read(calculatorPath)
  const terminology = read(terminologyPath)
  const terms = [
    ["accountEquity", "Account Equity"],
    ["riskPerTrade", "Risk per Trade"],
    ["riskAmount", "Risk Amount"],
    ["plannedEntry", "Planned Entry"],
    ["initialStop", "Initial Stop"],
    ["riskPerShare", "Risk per Share"],
    ["estimatedCommission", "Estimated Commission"],
    ["slippageAllowance", "Slippage Allowance"],
    ["tradeSize", "Trade Size"],
    ["positionValue", "Position Value"],
    ["activeRisk", "Active Risk"],
    ["maxActiveRisk", "Max Active Risk"],
    ["remainingRiskBudget", "Remaining Risk Budget"],
  ] as const

  for (const [term, label] of terms) {
    assert.match(terminology, new RegExp(`label:\\s*"${escapeRegExp(label)}"`), `missing shared label ${label}`)
    assert.match(calculator, new RegExp(`term="${term}"`), `calculator does not render ${term}`)
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
  const calculator = read(calculatorPath)
  const terminology = read(terminologyPath)
  assert.match(calculator, /term="riskAddedByPlannedTrade"/)
  assert.match(calculator, /term="projectedActiveRisk"/)
  assert.match(terminology, /label:\s*"Risk Added by Planned Trade"/)
  assert.match(terminology, /label:\s*"Projected Active Risk"/)
  assert.match(calculator, /Risk Unknown/)
  assert.match(calculator, /unknownRiskTradeCount/)
  assert.doesNotMatch(calculator, /unknownRiskTradeCount[^\n]{0,80}within plan/i)
})

test("Advanced evidence keeps Optimal f informational and unavailable without history", () => {
  const calculator = read(calculatorPath)
  const terminology = read(terminologyPath)

  assert.match(calculator, /<details/)
  assert.match(calculator, /term="winRatio"/)
  assert.match(calculator, /term="payoffRatio"/)
  assert.match(calculator, /term="optimalF"/)
  assert.match(terminology, /label:\s*"Win Ratio"/)
  assert.match(terminology, /label:\s*"Payoff Ratio"/)
  assert.match(terminology, /label:\s*"Optimal f"/)
  assert.match(calculator, /Insufficient History/)
  assert.match(calculator, /informational/i)
  assert.match(calculator, /more aggressive/i)
  assert.match(calculator, /not auto-applied/i)
  assert.match(calculator, /not a zero-ROR guarantee/i)
  assert.match(calculator, /calculateOptimalF/)
  assert.doesNotMatch(calculator, /Risk of Ruin probability|probability matrix|ROR probability table/i)
  assert.doesNotMatch(calculator, /setRiskPercentInput\([^\n]*optimal/i)
})
