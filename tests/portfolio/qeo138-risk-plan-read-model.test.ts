import assert from "node:assert/strict"
import test from "node:test"

import { buildTradeReadModel } from "../../modules/portfolio/trades/read-model.ts"

const baseTrade = {
  id: "11111111-1111-4111-8111-111111111111",
  portfolio_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  ticker: "VIC",
  mode: "live" as const,
  status: "open" as const,
  initial_stop_loss_exit: 88,
  created_at: "2026-09-07T01:00:00.000Z",
  updated_at: "2026-09-07T01:00:00.000Z",
}

test("Trade read model exposes immutable entry-time Money Management Plan provenance", () => {
  const planId = "44444444-4444-4444-8444-444444444444"
  const model = buildTradeReadModel({
    trade: { ...baseTrade, money_management_plan_id: planId },
    fills: [],
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.moneyManagementPlanId, planId)
  assert.equal(model.completeness.moneyManagementPlanState, "available")
})

test("missing Trade plan provenance remains unknown and is never replaced by a current plan", () => {
  const model = buildTradeReadModel({
    trade: { ...baseTrade, money_management_plan_id: null },
    fills: [],
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.moneyManagementPlanId, null)
  assert.equal(model.completeness.moneyManagementPlanState, "unknown")
  assert.equal("currentMoneyManagementPlanId" in model, false)
})
