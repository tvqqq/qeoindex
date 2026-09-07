import assert from "node:assert/strict"
import test from "node:test"

import {
  assertFrozenTradeFieldsUnchanged,
  assertTradeTransition,
  canTransitionTrade,
  normalizeJournalEntryInput,
  normalizeStopEventInput,
  normalizeTradeCreateInput,
} from "../../modules/portfolio/trades/validation.ts"

const ALLOWED: Array<[string, string]> = [
  ["planned", "open"],
  ["planned", "cancelled"],
  ["open", "partially_closed"],
  ["open", "closed"],
  ["partially_closed", "closed"],
]

const STATUSES = ["planned", "open", "partially_closed", "closed", "cancelled"] as const

test("Trade lifecycle allows only the approved transition matrix", () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = ALLOWED.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to)
      assert.equal(canTransitionTrade(from, to), expected, `${from} -> ${to}`)
    }
  }
})

test("invalid lifecycle transitions fail closed", () => {
  assert.throws(
    () => assertTradeTransition("closed", "open"),
    /Cannot transition Trade from closed to open/,
  )
  assert.throws(
    () => assertTradeTransition("cancelled", "planned"),
    /Cannot transition Trade from cancelled to planned/,
  )
})

test("Trade creation normalizes ticker and canonical plan fields", () => {
  const input = normalizeTradeCreateInput({
    ticker: " fpt ",
    mode: "paper",
    trade_type: "position",
    timeframe: "1D",
    system_tags: [" Breakout ", "Breakout", "Trend"],
    setup_tags: ["VCP"],
    planned_entry: 125.5,
    initial_stop_loss_exit: 119,
    initial_account_equity: 500_000_000,
    initial_risk_percent: 1.5,
    initial_risk_amount: 7_500_000,
    initial_risk_amount_per_share: 6.5,
    planned_trade_size: 1_100,
    planned_position_value: 138_050_000,
    estimated_commission: 200_000,
    slippage_allowance: 300_000,
    pre_trade_plan: "Buy only after confirmation",
  })

  assert.equal(input.ticker, "FPT")
  assert.equal(input.mode, "paper")
  assert.equal(input.status, "planned")
  assert.deepEqual(input.system_tags, ["Breakout", "Trend"])
  assert.equal(input.initial_risk_percent, 1.5)
  assert.equal(input.initial_stop_loss_exit, 119)
})

test("Trade creation rejects invalid ticker, enum and risk values", () => {
  assert.throws(() => normalizeTradeCreateInput({ ticker: "F PT" }), /Ticker is invalid/)
  assert.throws(() => normalizeTradeCreateInput({ ticker: "FPT", mode: "backtest" }), /mode is invalid/)
  assert.throws(
    () => normalizeTradeCreateInput({ ticker: "FPT", initial_risk_percent: 101 }),
    /initial_risk_percent must be between 0 and 100/,
  )
  assert.throws(
    () => normalizeTradeCreateInput({ ticker: "FPT", initial_stop_loss_exit: 0 }),
    /initial_stop_loss_exit must be greater than 0/,
  )
})

test("initial plan and risk snapshot fields freeze after Trade opens", () => {
  const existing = {
    status: "open" as const,
    planned_entry: 125.5,
    initial_stop_loss_exit: 119,
    initial_account_equity: 500_000_000,
    initial_risk_percent: 1.5,
    initial_risk_amount: 7_500_000,
    initial_risk_amount_per_share: 6.5,
    planned_trade_size: 1_100,
    planned_position_value: 138_050_000,
    estimated_commission: 200_000,
    slippage_allowance: 300_000,
  }

  assert.doesNotThrow(() =>
    assertFrozenTradeFieldsUnchanged(existing, { initial_stop_loss_exit: 119 }),
  )
  assert.throws(
    () => assertFrozenTradeFieldsUnchanged(existing, { initial_stop_loss_exit: 118 }),
    /initial_stop_loss_exit is frozen after Trade opens/,
  )
  assert.throws(
    () => assertFrozenTradeFieldsUnchanged(existing, { initial_risk_percent: 2 }),
    /initial_risk_percent is frozen after Trade opens/,
  )
})

test("planned Trade may still edit initial snapshot fields", () => {
  assert.doesNotThrow(() =>
    assertFrozenTradeFieldsUnchanged(
      { status: "planned", initial_stop_loss_exit: 119 },
      { initial_stop_loss_exit: 118 },
    ),
  )
})

test("stop event validation preserves explicit stop evidence", () => {
  const stop = normalizeStopEventInput({
    stop_type: "trailing",
    price: 130.5,
    quantity_covered: 500,
    signal: "Higher low",
    reason: "Trail below support",
    effective_at: "2026-09-07T09:00:00.000Z",
  })

  assert.equal(stop.stop_type, "trailing")
  assert.equal(stop.price, 130.5)
  assert.equal(stop.quantity_covered, 500)
  assert.equal(stop.effective_at, "2026-09-07T09:00:00.000Z")

  assert.throws(() => normalizeStopEventInput({ stop_type: "manual", price: 0 }), /price must be greater than 0/)
  assert.throws(() => normalizeStopEventInput({ stop_type: "guess", price: 100 }), /stop_type is invalid/)
})

test("journal validation records user evidence without inferring psychology", () => {
  const entry = normalizeJournalEntryInput({
    phase: "during",
    note: "  Hesitated after breakout retest.  ",
    emotion_tags: ["Fear", " Fear ", "Hope"],
    behavior_tags: ["Late entry"],
    adherence_status: "deviated",
    override_reason: "Waited for additional confirmation",
    occurred_at: "2026-09-07T09:05:00.000Z",
  })

  assert.equal(entry.note, "Hesitated after breakout retest.")
  assert.deepEqual(entry.emotion_tags, ["Fear", "Hope"])
  assert.equal(entry.adherence_status, "deviated")

  const noPsychology = normalizeJournalEntryInput({ phase: "before", note: "Plan recorded" })
  assert.deepEqual(noPsychology.emotion_tags, [])
  assert.deepEqual(noPsychology.behavior_tags, [])
  assert.equal(noPsychology.adherence_status, null)

  assert.throws(() => normalizeJournalEntryInput({ phase: "during", note: "   " }), /note is required/)
})
