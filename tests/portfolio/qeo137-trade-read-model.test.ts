import assert from "node:assert/strict"
import test from "node:test"

import { buildTradeReadModel } from "../../modules/portfolio/trades/read-model.ts"

const baseTrade = {
  id: "11111111-1111-4111-8111-111111111111",
  portfolio_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  ticker: "FPT",
  mode: "live" as const,
  status: "open" as const,
  planned_entry: 125,
  initial_stop_loss_exit: null,
  initial_account_equity: null,
  initial_risk_percent: null,
  initial_risk_amount: null,
  initial_risk_amount_per_share: null,
  planned_trade_size: null,
  planned_position_value: null,
  estimated_commission: null,
  slippage_allowance: null,
  opened_at: "2026-09-07T02:00:00.000Z",
  closed_at: null,
  created_at: "2026-09-07T01:00:00.000Z",
  updated_at: "2026-09-07T02:00:00.000Z",
}

const fill = {
  id: "44444444-4444-4444-8444-444444444444",
  trade_id: baseTrade.id,
  ticker: "FPT",
  action: "buy",
  quantity: 1000,
  price: 125,
  fee: 100,
  transaction_date: "2026-09-07",
}

test("missing stop stays unknown rather than becoming numeric zero", () => {
  const model = buildTradeReadModel({
    trade: baseTrade,
    fills: [fill],
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.completeness.stopState, "unknown")
  assert.equal(model.latestStop, null)
  assert.notEqual(model.latestStop, 0)
})

test("initial stop is the latest known stop when no later stop event exists", () => {
  const model = buildTradeReadModel({
    trade: { ...baseTrade, initial_stop_loss_exit: 119 },
    fills: [fill],
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.completeness.stopState, "known")
  assert.deepEqual(model.latestStop, {
    price: 119,
    source: "initial",
    effectiveAt: baseTrade.opened_at,
  })
})

test("latest stop event wins deterministically by effective_at then created_at", () => {
  const model = buildTradeReadModel({
    trade: { ...baseTrade, initial_stop_loss_exit: 119 },
    fills: [fill],
    stopEvents: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        stop_type: "trailing",
        price: 123,
        effective_at: "2026-09-07T05:00:00.000Z",
        created_at: "2026-09-07T05:01:00.000Z",
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        stop_type: "support",
        price: 124,
        effective_at: "2026-09-07T05:00:00.000Z",
        created_at: "2026-09-07T05:02:00.000Z",
      },
      {
        id: "77777777-7777-4777-8777-777777777777",
        stop_type: "manual",
        price: 122,
        effective_at: "2026-09-07T04:00:00.000Z",
        created_at: "2026-09-07T05:03:00.000Z",
      },
    ],
    journalEntries: [],
  })

  assert.equal(model.latestStop?.price, 124)
  assert.equal(model.latestStop?.source, "support")
  assert.equal(model.latestStop?.effectiveAt, "2026-09-07T05:00:00.000Z")
})

test("initial risk completeness is available, partial, or unknown", () => {
  const unknown = buildTradeReadModel({ trade: baseTrade, fills: [], stopEvents: [], journalEntries: [] })
  assert.equal(unknown.completeness.initialRiskState, "unknown")

  const partial = buildTradeReadModel({
    trade: { ...baseTrade, initial_risk_percent: 1.5 },
    fills: [],
    stopEvents: [],
    journalEntries: [],
  })
  assert.equal(partial.completeness.initialRiskState, "partial")

  const available = buildTradeReadModel({
    trade: {
      ...baseTrade,
      initial_account_equity: 500_000_000,
      initial_risk_percent: 1.5,
      initial_risk_amount: 7_500_000,
      initial_risk_amount_per_share: 6,
      planned_trade_size: 1200,
    },
    fills: [],
    stopEvents: [],
    journalEntries: [],
  })
  assert.equal(available.completeness.initialRiskState, "available")
})

test("journal evidence is availability metadata, never inferred psychology", () => {
  const unavailable = buildTradeReadModel({ trade: baseTrade, fills: [], stopEvents: [], journalEntries: [] })
  assert.equal(unavailable.completeness.journalState, "unavailable")
  assert.deepEqual(unavailable.journalEntries, [])

  const available = buildTradeReadModel({
    trade: baseTrade,
    fills: [],
    stopEvents: [],
    journalEntries: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        phase: "during",
        note: "Felt hesitant",
        emotion_tags: ["Fear"],
        behavior_tags: [],
        adherence_status: null,
        occurred_at: "2026-09-07T05:10:00.000Z",
        created_at: "2026-09-07T05:10:01.000Z",
      },
    ],
  })
  assert.equal(available.completeness.journalState, "available")
  assert.deepEqual(available.journalEntries[0]?.emotion_tags, ["Fear"])
})

test("multiple fills remain grouped beneath one logical Trade", () => {
  const model = buildTradeReadModel({
    trade: baseTrade,
    fills: [
      fill,
      { ...fill, id: "99999999-9999-4999-8999-999999999999", quantity: 500, price: 127 },
      { ...fill, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", action: "sell", quantity: 700, price: 133 },
    ],
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.trade.id, baseTrade.id)
  assert.equal(model.fills.length, 3)
  assert.ok(model.fills.every((row) => row.trade_id === baseTrade.id))
})

test("closed Trade emits one deterministic posting-card outcome across scale-in and scale-out fills", () => {
  const closedTrade = {
    ...baseTrade,
    status: "closed" as const,
    initial_risk_amount: 2_000_000,
    closed_at: "2026-09-08T07:00:00.000Z",
  }
  const fills = [
    { ...fill, id: "b0000000-0000-4000-8000-000000000001", quantity: 100, price: 100, fee: 10 },
    { ...fill, id: "b0000000-0000-4000-8000-000000000002", quantity: 100, price: 110, fee: 10 },
    { ...fill, id: "b0000000-0000-4000-8000-000000000003", action: "sell", quantity: 50, price: 120, fee: 5 },
    { ...fill, id: "b0000000-0000-4000-8000-000000000004", action: "sell", quantity: 150, price: 130, fee: 15 },
  ]

  const model = buildTradeReadModel({
    trade: closedTrade,
    fills,
    stopEvents: [],
    journalEntries: [],
  })

  assert.equal(model.closeReview.status, "available")
  assert.equal(model.closeReview.outcome, "winner")
  assert.equal(model.closeReview.totalPaidVnd, 21_020_000)
  assert.equal(model.closeReview.totalReceivedVnd, 25_480_000)
  assert.equal(model.closeReview.totalFeesVnd, 40_000)
  assert.equal(model.closeReview.netPnlVnd, 4_460_000)
  assert.ok(model.closeReview.pnlPercent != null && Math.abs(model.closeReview.pnlPercent - 21.21788772597526) < 1e-9)
  assert.ok(model.closeReview.rMultiple != null && Math.abs(model.closeReview.rMultiple - 2.23) < 1e-9)
  assert.equal(model.fills.length, 4)
})
