import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const riskServerUrl = new URL(
  "../../modules/portfolio/risk-engine/server.ts",
  import.meta.url,
)
const performanceServerUrl = new URL(
  "../../modules/portfolio/performance/server.ts",
  import.meta.url,
)

test("QEO-141 risk context loads external funding and fails closed on legacy percentages", () => {
  const source = readFileSync(riskServerUrl, "utf8")

  assert.match(source, /initial_capital,funding_history_status/)
  assert.match(source, /from\("portfolio_external_cash_flows"\)/)
  assert.match(source, /signed_amount_vnd/)
  assert.match(source, /effective_at/)
  assert.match(source, /fundingHistoryStatus/)
  assert.match(source, /externalCashFlows/)
  assert.match(source, /fundingHistoryStatus\s*===\s*"known"[\s\S]{0,240}activeRiskPercent/)
})

test("QEO-142 performance context uses flow-adjusted equity and explicit funding completeness", () => {
  const source = readFileSync(performanceServerUrl, "utf8")

  assert.match(source, /initial_capital,funding_history_status/)
  assert.match(source, /from\("portfolio_external_cash_flows"\)/)
  assert.match(source, /signed_amount_vnd/)
  assert.match(source, /effective_at/)
  assert.match(source, /fundingHistoryStatus/)
  assert.match(source, /externalCashFlows/)
  assert.match(source, /flowAdjustedEquityVnd/)
  assert.match(source, /fundingHistoryStatus\s*===\s*"known"/)
})
