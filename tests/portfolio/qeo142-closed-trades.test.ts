import assert from "node:assert/strict"
import test from "node:test"

import { deriveClosedTradeOutcomes } from "../../modules/portfolio/performance/closed-trades.ts"

const baseTrade = {
  id: "t1",
  ticker: "FPT",
  mode: "live" as const,
  status: "closed",
  timeframe: "swing",
  system_tags: ["trend"],
  setup_tags: ["breakout"],
  initial_risk_amount: 1_000_000,
  closed_at: "2026-09-05T08:00:00Z",
}

const buy = {
  id: "b1",
  trade_id: "t1",
  ticker: "FPT",
  action: "buy" as const,
  quantity: 100,
  price: 100,
  fee: 10,
  transaction_date: "2026-09-01",
  tags: [],
  mistake_tags: [],
}

const sell1 = {
  id: "s1",
  trade_id: "t1",
  ticker: "FPT",
  action: "sell" as const,
  quantity: 40,
  price: 110,
  fee: 4,
  transaction_date: "2026-09-04",
  tags: [],
  mistake_tags: ["late-exit"],
}

const sell2 = {
  id: "s2",
  trade_id: "t1",
  ticker: "FPT",
  action: "sell" as const,
  quantity: 60,
  price: 112,
  fee: 6,
  transaction_date: "2026-09-05",
  tags: [],
  mistake_tags: ["late-exit", "hesitation"],
}

test("multi-fill campaign counts once and reconciles gross fees and net", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [baseTrade],
    fills: [buy, sell1, sell2],
  })

  assert.equal(result.outcomes.length, 1)
  assert.equal(result.closedCandidateCount, 1)
  assert.equal(result.excludedClosedTradeCount, 0)
  assert.equal(result.outcomes[0]?.totalFeesVnd, 20_000)
  assert.equal(
    result.outcomes[0]?.grossPnlVnd,
    result.outcomes[0]!.netPnlVnd + 20_000,
  )
  assert.equal(result.outcomes[0]?.outcome, "winner")
})

test("gross-positive but fee-negative Trade is classified by net PnL", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [{ ...baseTrade, id: "t2", ticker: "VCB" }],
    fills: [
      {
        id: "b2",
        trade_id: "t2",
        ticker: "VCB",
        action: "buy" as const,
        quantity: 1,
        price: 100,
        fee: 0.6,
        transaction_date: "2026-09-01",
        tags: [],
      },
      {
        id: "s3",
        trade_id: "t2",
        ticker: "VCB",
        action: "sell" as const,
        quantity: 1,
        price: 101,
        fee: 0.6,
        transaction_date: "2026-09-05",
        tags: [],
      },
    ],
  })

  assert.equal(result.outcomes[0]?.grossPnlVnd, 1_000)
  assert.equal(result.outcomes[0]?.netPnlVnd, -200)
  assert.equal(result.outcomes[0]?.outcome, "loser")
})

test("legacy ungrouped fill is evidence only and never a synthetic Trade", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [],
    fills: [
      {
        id: "legacy",
        trade_id: null,
        ticker: "HPG",
        action: "sell" as const,
        quantity: 10,
        price: 30,
        fee: 1,
        transaction_date: "2026-09-05",
        tags: [],
      },
    ],
  })

  assert.equal(result.outcomes.length, 0)
  assert.equal(result.legacyUngroupedTransactionCount, 1)
  assert.equal(result.completeness, "insufficient")
})

test("closed Trade with incomplete fill history is excluded explicitly", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [baseTrade],
    fills: [buy],
  })

  assert.equal(result.outcomes.length, 0)
  assert.equal(result.closedCandidateCount, 1)
  assert.equal(result.excludedClosedTradeCount, 1)
  assert.equal(result.completeness, "insufficient")
})

test("journal behavior and fill mistake tags are normalized as unique unions", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [baseTrade],
    fills: [buy, sell1, sell2],
    journalEntries: [
      { trade_id: "t1", behavior_tags: ["fomo", "hesitation"] },
      { trade_id: "t1", behavior_tags: ["hesitation"] },
    ],
  })

  assert.deepEqual(result.outcomes[0]?.behaviorTags, ["fomo", "hesitation"])
  assert.deepEqual(result.outcomes[0]?.mistakeTags, ["hesitation", "late-exit"])
})

test("explicit stop-out requires stop-event to linked exit-fill evidence", () => {
  const noLink = deriveClosedTradeOutcomes({
    trades: [baseTrade],
    fills: [buy, sell1, sell2],
    stopEvents: [{ id: "stop-1", trade_id: "t1" }],
    stopExitFillLinks: [],
  })
  assert.equal(noLink.outcomes[0]?.explicitStopOut, false)

  const linked = deriveClosedTradeOutcomes({
    trades: [baseTrade],
    fills: [buy, sell1, sell2],
    stopEvents: [{ id: "stop-1", trade_id: "t1" }],
    stopExitFillLinks: [
      { stop_event_id: "stop-1", transaction_id: "s2", trade_id: "t1" },
    ],
  })
  assert.equal(linked.outcomes[0]?.explicitStopOut, true)
})
