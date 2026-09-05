import assert from "node:assert/strict"
import test from "node:test"

import {
  ResearchReportBudgetExceededError,
  createResearchReportAiBudget,
} from "../../modules/research-reports/analysis/budget.ts"

test("QEO-85 consumes the request-attempt budget before dispatch", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 2,
    maxEstimatedCostUsd: 1,
  })

  budget.beforeRequest({ reservedCostUsd: 0.1 })
  budget.beforeRequest({ reservedCostUsd: 0.1 })

  assert.deepEqual(budget.snapshot(), {
    requestAttempts: 2,
    maxRequestAttempts: 2,
    estimatedCostUsd: 0,
    maxEstimatedCostUsd: 1,
    unknownUsageAttempts: 0,
    budgetExhausted: false,
    budgetReason: null,
  })

  assert.throws(
    () => budget.beforeRequest({ reservedCostUsd: 0.1 }),
    (error: unknown) => error instanceof ResearchReportBudgetExceededError
      && error.reason === "ai_request_limit",
  )
})

test("QEO-85 blocks a request whose conservative reservation exceeds remaining USD", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 20,
    maxEstimatedCostUsd: 1,
  })

  budget.recordResponseCost(0.85)
  assert.throws(
    () => budget.beforeRequest({ reservedCostUsd: 0.16 }),
    (error: unknown) => error instanceof ResearchReportBudgetExceededError
      && error.reason === "estimated_cost_limit",
  )
  assert.equal(budget.snapshot().requestAttempts, 0)
  assert.equal(budget.snapshot().budgetExhausted, true)
})

test("QEO-85 records lost-response attempts as unknown usage without fabricating cost", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 20,
    maxEstimatedCostUsd: 1,
  })

  budget.beforeRequest({ reservedCostUsd: 0.3 })
  budget.recordUnknownUsage()

  const snapshot = budget.snapshot()
  assert.equal(snapshot.requestAttempts, 1)
  assert.equal(snapshot.unknownUsageAttempts, 1)
  assert.equal(snapshot.estimatedCostUsd, 0)
})

test("QEO-85 accumulates confirmed provider cost without counting reservations as spend", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 20,
    maxEstimatedCostUsd: 1,
  })

  budget.beforeRequest({ reservedCostUsd: 0.4 })
  budget.recordResponseCost(0.012345)
  budget.beforeRequest({ reservedCostUsd: 0.4 })
  budget.recordResponseCost(0.02)

  assert.equal(budget.snapshot().estimatedCostUsd, 0.032345)
  assert.equal(budget.snapshot().requestAttempts, 2)
})
