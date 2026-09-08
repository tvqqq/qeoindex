import assert from "node:assert/strict"
import test from "node:test"

import { computeOpenTradeActiveRisk } from "../../modules/portfolio/risk-engine/active-risk.ts"

const trade = {
  id: "trade-1",
  portfolio_id: "p1",
  user_id: "u1",
  ticker: "FPT",
  mode: "live" as const,
  status: "open" as const,
  initial_stop_loss_exit: 95,
  initial_risk_amount: 510_000,
  initial_risk_percent: 1,
  opened_at: "2026-09-01T02:00:00Z",
  created_at: "2026-09-01T02:00:00Z",
  updated_at: "2026-09-01T02:00:00Z",
}

const buy = {
  id: "b1",
  trade_id: "trade-1",
  ticker: "FPT",
  action: "buy" as const,
  quantity: 100,
  price: 100,
  fee: 10,
  transaction_date: "2026-09-01",
  tags: [],
}

test("entry fee is inside AVCO and current Active Risk is stop based", () => {
  const result = computeOpenTradeActiveRisk({ trades: [trade], fills: [buy], stopEvents: [] })
  assert.equal(result.rows[0]?.avgCostKvnd, 100.1)
  assert.equal(result.rows[0]?.currentStopKvnd, 95)
  assert.equal(result.rows[0]?.activeRiskVnd, 510_000)
  assert.equal(result.knownActiveRiskVnd, 510_000)
})

test("trailing stop above AVCO reduces downside Trade Risk to zero", () => {
  const result = computeOpenTradeActiveRisk({
    trades: [trade],
    fills: [buy],
    stopEvents: [{
      id: "s2",
      trade_id: "trade-1",
      stop_type: "trailing",
      price: 101,
      effective_at: "2026-09-02T02:00:00Z",
      created_at: "2026-09-02T02:00:00Z",
    }],
  })
  assert.equal(result.rows[0]?.activeRiskVnd, 0)
})

test("partial exit reduces open quantity and active risk", () => {
  const sell = {
    id: "x1",
    trade_id: "trade-1",
    ticker: "FPT",
    action: "sell" as const,
    quantity: 40,
    price: 110,
    fee: 10,
    transaction_date: "2026-09-03",
    tags: [],
  }
  const result = computeOpenTradeActiveRisk({ trades: [trade], fills: [buy, sell], stopEvents: [] })
  assert.equal(result.rows[0]?.openQty, 60)
  assert.equal(result.rows[0]?.activeRiskVnd, 306_000)
})

test("missing stop is unknown and never coerced to zero", () => {
  const result = computeOpenTradeActiveRisk({
    trades: [{ ...trade, initial_stop_loss_exit: null }],
    fills: [buy],
    stopEvents: [],
  })
  assert.equal(result.rows[0]?.riskStatus, "unknown")
  assert.equal(result.rows[0]?.activeRiskVnd, null)
  assert.equal(result.unknownRiskItemCount, 1)
})
