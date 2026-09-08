import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const calculatorPath = "components/portfolio/risk-sizing/trade-size-calculator.tsx"
const advisorPath = "components/portfolio/risk-sizing/trade-size-advisor.tsx"
const combinedPath = "components/portfolio/risk-sizing/combined-portfolio-simulation.tsx"
const hookPath = "components/portfolio/risk-sizing/use-risk-sizing-context.ts"
const tooltipPath = "components/portfolio/risk-sizing/risk-metric-tooltip.tsx"
const allocationPath = "components/portfolio/portfolio-capital-allocation.tsx"
const panel1Path = "components/portfolio/risk-sizing/portfolio-allocation-advisor.tsx"
const panel2Path = "components/portfolio/risk-sizing/portfolio-current-state.tsx"
const pagePath = "components/portfolio/portfolio-page.tsx"
const terminologyPath = "modules/portfolio/risk-sizing/terminology.ts"
const pnlPath = "modules/portfolio/pnl.ts"
const pnlTestPath = "tests/portfolio-pnl.test.ts"

function read(path: string) {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

test("stop-first Trade Size surface exposes canonical McDowell/QeoIndex terms through shared metadata", () => {
  const surface = `${read(advisorPath)}\n${read(panel1Path)}`
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
    assert.match(surface, new RegExp(`term="${term}"`), `portfolio sizing surface does not render ${term}`)
  }
})

test("allocation owns one authenticated risk-context fetch and advisor stays deterministic", () => {
  const hook = read(hookPath)
  const allocation = read(allocationPath)
  const advisor = read(advisorPath)

  assert.match(hook, /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing`/)
  assert.match(hook, /AbortController/)
  assert.match(hook, /cache:\s*"no-store"/)
  assert.match(hook, /credentials:\s*"same-origin"/)
  assert.match(allocation, /useRiskSizingContext\(activePortfolioId\)/)
  assert.doesNotMatch(advisor, /fetch\(`\/api\/portfolio\/\$\{portfolioId\}\/risk-sizing`/)
  assert.match(advisor, /calculateTradeSize/)
  assert.match(allocation, /simulatePlannedTrades/)
  assert.match(advisor, /RiskMetricTooltip/)
  assert.doesNotMatch(`${hook}\n${allocation}\n${advisor}`, /createClient|supabase\.|\.from\(/)
})

test("four-panel portfolio workflow restores Panels 1 and 2 without per-Trade fields in Panel 1", () => {
  const allocation = read(allocationPath)
  const panel1 = read(panel1Path)
  const panel2 = read(panel2Path)
  const combined = read(combinedPath)
  const composed = `${allocation}\n${panel1}\n${panel2}\n${combined}`

  for (const heading of [
    "1. Portfolio Allocation Advisor",
    "2. Current Portfolio State",
    "3. Trade Size Advisor",
    "4. Combined Portfolio Simulation",
  ]) {
    assert.match(composed, new RegExp(escapeRegExp(heading)), `missing four-panel heading: ${heading}`)
  }

  assert.match(allocation, /lg:grid-cols-2/)
  assert.doesNotMatch(panel1, /plannedEntry|initialStop/)
})

test("ticker-first Trade Size Advisor owns ephemeral planned basket behavior", () => {
  const advisor = read(advisorPath)
  const allocation = read(allocationPath)

  for (const label of [
    "Ticker",
    "Risk per Trade",
    "Planned Entry",
    "Initial Stop",
    "Estimated Commission",
    "Slippage Allowance",
    "Add Planned Trade",
    "Planned Trades",
    "Edit",
    "Remove",
  ]) {
    assert.match(advisor, new RegExp(escapeRegExp(label)), `Trade Size Advisor missing ${label}`)
  }

  assert.match(advisor, /calculateTradeSize/)
  assert.match(advisor, /\.toUpperCase\(\)/)
  assert.match(allocation, /<TradeSizeAdvisor/)
  assert.match(allocation, /upsertPlannedTrade/)
  assert.match(allocation, /removePlannedTrade/)
  assert.doesNotMatch(advisor, /method:\s*["'](?:POST|PUT|PATCH)["']/i)
  assert.doesNotMatch(advisor, /localStorage|sessionStorage|indexedDB/i)
})

test("combined simulation panel renders before planned after states and both deterministic advisors", () => {
  const combined = read(combinedPath)
  const allocation = read(allocationPath)

  for (const label of [
    "Before",
    "Planned",
    "After",
    "Portfolio Allocation Advisor",
    "Trade Size Advisor",
    "Combined Verdict",
    "Projected Active Risk",
    "Funding Gap",
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(label)), `Combined Portfolio Simulation missing ${label}`)
  }

  assert.match(allocation, /<CombinedPortfolioSimulation/)
  assert.doesNotMatch(combined, /confidence score|will rise|expected target|probability/i)
})

test("monolithic calculator is retired after ticker-first advisor migration", () => {
  assert.equal(read(calculatorPath), "")
})

test("legacy fixed-stop assumptions and unsafe risk claims are removed from the allocation surface", () => {
  const source = `${read(allocationPath)}\n${read(advisorPath)}`
  assert.doesNotMatch(source, /triệt tiêu hoàn toàn nguy cơ/i)
  assert.doesNotMatch(source, /dealStopLossPct|7\.0.*Stoploss/i)
  assert.doesNotMatch(source, /% Cắt lỗ deal tiếp theo/i)
})

test("legacy fixed-fractional sizing helper is removed from the portfolio domain", () => {
  const pnl = read(pnlPath)
  const pnlTest = read(pnlTestPath)

  assert.doesNotMatch(pnl, /export function calculatePositionSizing/)
  assert.doesNotMatch(pnlTest, /calculatePositionSizing|Fixed Fractional Account Risk/)
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
  const source = read(advisorPath)
  assert.match(source, /support|resistance/i)
  assert.match(source, /volatility|price activity/i)
  assert.match(source, /trading-system|system rule/i)
  assert.match(source, /trailing stop/i)
  assert.match(source, /gap/i)
  assert.match(source, /liquidity/i)
  assert.match(source, /overnight/i)
  assert.match(source, /slippage/i)

  const sourceWithoutExplicitNoGuaranteeDisclaimer = source.replace(/not a zero-ROR guarantee/gi, "")
  assert.doesNotMatch(sourceWithoutExplicitNoGuaranteeDisclaimer, /guarantee|bảo đảm.*không.*thua|không thể cháy/i)
})

test("planned basket simulation stays fail-closed for unknown current risk evidence", () => {
  const allocation = read(allocationPath)
  assert.match(allocation, /summarizePortfolioRiskCoverage/)
  assert.match(allocation, /simulatePlannedTrades/)
  assert.match(allocation, /unknownRiskItemCount:\s*riskCoverage\.unknownRiskItemCount/)
  assert.match(allocation, /riskContextAvailable:\s*riskSizing\.context\s*!=\s*null/)
  assert.match(allocation, /plannedTrades,/)
})

test("risk context failure remains explicit in advisor and combined simulation", () => {
  const advisor = read(advisorPath)
  const combined = read(combinedPath)
  assert.match(advisor, /const riskContextUnavailable = !loadingRiskContext && riskContext == null/)
  assert.match(advisor, /Risk context unavailable/)
  assert.match(combined, /riskContextAvailable/)
  assert.match(combined, /Risk context unavailable/)
  assert.match(combined, /!riskContextAvailable\) return "Unavailable"/)
})

test("Advanced evidence keeps Optimal f informational and unavailable without history", () => {
  const advisor = read(advisorPath)
  const terminology = read(terminologyPath)

  assert.match(advisor, /<details/)
  assert.match(advisor, /term="winRatio"/)
  assert.match(advisor, /term="payoffRatio"/)
  assert.match(advisor, /term="optimalF"/)
  assert.match(terminology, /label:\s*"Win Ratio"/)
  assert.match(terminology, /label:\s*"Payoff Ratio"/)
  assert.match(terminology, /label:\s*"Optimal f"/)
  assert.match(advisor, /Insufficient History/)
  assert.match(advisor, /informational/i)
  assert.match(advisor, /more aggressive/i)
  assert.match(advisor, /not auto-applied/i)
  assert.match(advisor, /not a zero-ROR guarantee/i)
  assert.match(advisor, /calculateOptimalF/)
  assert.doesNotMatch(advisor, /Risk of Ruin probability|probability matrix|ROR probability table/i)
  assert.doesNotMatch(advisor, /setRiskPercentInput\([^\n]*optimal/i)
})
