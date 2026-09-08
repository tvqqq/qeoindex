import assert from "node:assert/strict"
import test from "node:test"

import {
  countConsecutiveExplicitStopOuts,
  deriveGuardrailTradeOutcomes,
  evaluateHolidayPeriodRule,
  evaluateRollingTradeLoss,
} from "../../modules/portfolio/risk-engine/trade-outcomes.ts"

const trades = [
  { id: "t1", ticker: "FPT", status: "closed", closed_at: "2026-09-02T08:00:00Z" },
  { id: "t2", ticker: "VHM", status: "closed", closed_at: "2026-09-03T08:00:00Z" },
  { id: "t3", ticker: "HPG", status: "closed", closed_at: "2026-09-04T08:00:00Z" },
]

const fills = [
  { id: "b1", trade_id: "t1", ticker: "FPT", action: "buy" as const, quantity: 100, price: 100, fee: 0, transaction_date: "2026-09-01", tags: [] },
  { id: "x1", trade_id: "t1", ticker: "FPT", action: "sell" as const, quantity: 100, price: 90, fee: 0, transaction_date: "2026-09-02", tags: [] },
  { id: "b2", trade_id: "t2", ticker: "VHM", action: "buy" as const, quantity: 100, price: 80, fee: 0, transaction_date: "2026-09-01", tags: [] },
  { id: "x2", trade_id: "t2", ticker: "VHM", action: "sell" as const, quantity: 100, price: 70, fee: 0, transaction_date: "2026-09-03", tags: [] },
  { id: "b3", trade_id: "t3", ticker: "HPG", action: "buy" as const, quantity: 100, price: 20, fee: 0, transaction_date: "2026-09-01", tags: [] },
  { id: "x3a", trade_id: "t3", ticker: "HPG", action: "sell" as const, quantity: 40, price: 25, fee: 0, transaction_date: "2026-09-04", tags: [] },
  { id: "x3b", trade_id: "t3", ticker: "HPG", action: "sell" as const, quantity: 60, price: 26, fee: 0, transaction_date: "2026-09-04", tags: [] },
]

const stopEvents = [{ id: "stop-1", trade_id: "t1" }]
const stopExitFillLinks = [{ stop_event_id: "stop-1", transaction_id: "x1", trade_id: "t1" }]

test("only explicit stop to exit evidence counts as a stop-out", () => {
  const rows = deriveGuardrailTradeOutcomes({ trades, fills, stopEvents, stopExitFillLinks })
  assert.equal(rows.find((row) => row.tradeId === "t1")?.explicitStopOut, true)
  assert.equal(rows.find((row) => row.tradeId === "t2")?.explicitStopOut, false)
})

test("multi-fill scale-out campaign emits one logical Trade outcome", () => {
  const rows = deriveGuardrailTradeOutcomes({ trades, fills, stopEvents, stopExitFillLinks })
  assert.equal(rows.filter((row) => row.tradeId === "t3").length, 1)
  assert.equal(rows.find((row) => row.tradeId === "t3")?.outcome, "winner")
  assert.deepEqual(rows.map((row) => row.tradeId), ["t1", "t2", "t3"])
})

test("rolling N Trade loss uses exact sample size and aggregate net PnL", () => {
  assert.deepEqual(
    evaluateRollingTradeLoss([{ netPnlVnd: -2 }, { netPnlVnd: 1 }], 2),
    { status: "triggered", sampleSize: 2, aggregateNetPnlVnd: -1 },
  )
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }], 2).status, "insufficient")
  assert.equal(evaluateRollingTradeLoss([{ netPnlVnd: -2 }, { netPnlVnd: 3 }], 2).status, "clear")
})

test("consecutive explicit stop-outs stop at the first non-stop-out Trade", () => {
  const rows = deriveGuardrailTradeOutcomes({ trades, fills, stopEvents, stopExitFillLinks })
  assert.equal(countConsecutiveExplicitStopOuts(rows), 0)
  assert.equal(countConsecutiveExplicitStopOuts([rows[1]!, rows[0]!]), 1)
})

test("holiday percentage rule is insufficient without period-start Account Equity", () => {
  const result = evaluateHolidayPeriodRule({
    period: "weekly",
    rule: { enabled: true, lossPercent: 5 },
    outcomes: [],
    dailyNetPnlVnd: [],
    periodStartEquityVnd: null,
  })
  assert.equal(result.status, "insufficient")
})

test("holiday loss amount and consecutive losing Trades trigger from current-period evidence", () => {
  const outcomes = deriveGuardrailTradeOutcomes({ trades, fills, stopEvents, stopExitFillLinks }).slice(0, 2)
  const result = evaluateHolidayPeriodRule({
    period: "weekly",
    rule: { enabled: true, consecutiveLosingTrades: 2, lossAmount: 1_500_000 },
    outcomes,
    dailyNetPnlVnd: [
      { date: "2026-09-02", netPnlVnd: -1_000_000 },
      { date: "2026-09-03", netPnlVnd: -1_000_000 },
    ],
    periodStartEquityVnd: 100_000_000,
  })
  assert.equal(result.status, "triggered")
})
