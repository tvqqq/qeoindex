import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  createProviderBudget,
  INTERACTIVE_CHART_PROVIDER_BUDGET_MS,
} from "../../modules/market/chart-data/provider-budget.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 interactive provider budget is shared and monotonically expires", () => {
  let now = 1_000
  const budget = createProviderBudget(INTERACTIVE_CHART_PROVIDER_BUDGET_MS, () => now)

  assert.equal(INTERACTIVE_CHART_PROVIDER_BUDGET_MS, 1_500)
  assert.equal(budget.remainingMs(), 1_500)
  now = 2_200
  assert.equal(budget.remainingMs(), 300)
  now = 2_501
  assert.equal(budget.remainingMs(), 0)
})

test("QEO-172 maintenance/default provider budget remains unbounded", () => {
  const budget = createProviderBudget(undefined, () => 123)
  assert.equal(budget.remainingMs(), null)
})

test("QEO-172 interactive read wires one bounded provider across closed recovery and live tail", () => {
  const provider = source("modules/market/chart-data/provider.ts")
  const service = source("modules/market/chart-data/service.ts")
  const dnse = source("modules/market/providers/dnse/history.ts")
  const vci = source("modules/market/providers/vci/history.ts")

  assert.match(provider, /createProviderBudget/)
  assert.match(provider, /totalBudgetMs\?: number/)
  assert.match(provider, /remainingMs/)
  assert.match(dnse, /budgetMs\?: number/)
  assert.match(vci, /timeoutMs\?: number/)

  assert.match(service, /INTERACTIVE_CHART_PROVIDER_BUDGET_MS/)
  assert.match(service, /createPrimaryChartOhlcvProvider\(\{\s*totalBudgetMs:\s*INTERACTIVE_CHART_PROVIDER_BUDGET_MS\s*\}\)/)
  assert.match(service, /runClosedProviderRange\([\s\S]*?provider[\s\S]*?\)/)
})
