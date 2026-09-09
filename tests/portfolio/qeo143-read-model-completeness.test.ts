import assert from "node:assert/strict"
import test from "node:test"

import { buildTradeReadModel } from "../../modules/portfolio/trades/read-model.ts"

test("migrated deterministic Trade exposes unknown mode and Scorecard ineligibility explicitly", () => {
  const trade = {
    id: "14314314-3143-4143-8143-143143143101",
    portfolio_id: "14314314-3143-4143-8143-143143143102",
    user_id: "14314314-3143-4143-8143-143143143103",
    ticker: "FPT",
    mode: "unknown" as const,
    status: "closed" as const,
    origin: "legacy_migration" as const,
    grouping_status: "deterministic" as const,
    scorecard_eligible: false,
    legacy_opened_on: "2026-08-01",
    legacy_closed_on: "2026-08-04",
    legacy_source_transaction_count: 2,
    money_management_plan_id: null,
    planned_entry: null,
    initial_stop_loss_exit: null,
    initial_account_equity: null,
    initial_risk_percent: null,
    initial_risk_amount: null,
    initial_risk_amount_per_share: null,
    planned_trade_size: null,
    planned_position_value: null,
    estimated_commission: null,
    slippage_allowance: null,
    opened_at: null,
    closed_at: null,
    created_at: "2026-09-09T00:00:00.000Z",
    updated_at: "2026-09-09T00:00:00.000Z",
  }

  const fills = [
    {
      id: "14314314-3143-4143-8143-143143143111",
      trade_id: trade.id,
      ticker: "FPT",
      action: "buy",
      quantity: 100,
      price: 100,
      fee: 1,
      transaction_date: "2026-08-01",
    },
    {
      id: "14314314-3143-4143-8143-143143143112",
      trade_id: trade.id,
      ticker: "FPT",
      action: "sell",
      quantity: 100,
      price: 110,
      fee: 1,
      transaction_date: "2026-08-04",
    },
  ]

  const model = buildTradeReadModel({
    trade,
    fills,
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.completeness.tradeGroupingState, "deterministic")
  assert.equal(model.completeness.modeState, "unknown")
  assert.equal(model.completeness.scorecardState, "ineligible")
  assert.equal(model.completeness.stopState, "unknown")
  assert.equal(model.completeness.initialRiskState, "unknown")
  assert.equal(model.completeness.journalState, "unavailable")
  assert.equal(model.moneyManagementPlanId, null)
})
