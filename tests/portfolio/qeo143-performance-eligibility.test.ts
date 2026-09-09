import assert from "node:assert/strict"
import test from "node:test"

import { deriveClosedTradeOutcomes } from "../../modules/portfolio/performance/closed-trades.ts"

const liveTradeId = "14314314-3143-4143-8143-143143143201"
const legacyTradeId = "14314314-3143-4143-8143-143143143202"

const fills = [
  {
    id: "14314314-3143-4143-8143-143143143211",
    trade_id: liveTradeId,
    ticker: "FPT",
    action: "buy" as const,
    quantity: 100,
    price: 100,
    fee: 1,
    transaction_date: "2026-08-01",
    tags: [],
  },
  {
    id: "14314314-3143-4143-8143-143143143212",
    trade_id: liveTradeId,
    ticker: "FPT",
    action: "sell" as const,
    quantity: 100,
    price: 110,
    fee: 1,
    transaction_date: "2026-08-04",
    tags: [],
  },
  {
    id: "14314314-3143-4143-8143-143143143221",
    trade_id: legacyTradeId,
    ticker: "MSN",
    action: "buy" as const,
    quantity: 100,
    price: 50,
    fee: 1,
    transaction_date: "2026-07-01",
    tags: [],
  },
  {
    id: "14314314-3143-4143-8143-143143143222",
    trade_id: legacyTradeId,
    ticker: "MSN",
    action: "sell" as const,
    quantity: 100,
    price: 60,
    fee: 1,
    transaction_date: "2026-07-04",
    tags: [],
  },
]

test("unknown or explicitly ineligible migrated Trade never enters closed-Trade Scorecard outcomes", () => {
  const result = deriveClosedTradeOutcomes({
    trades: [
      {
        id: liveTradeId,
        ticker: "FPT",
        mode: "live",
        status: "closed",
        timeframe: "1D",
        system_tags: [],
        setup_tags: [],
        initial_risk_amount: null,
        closed_at: "2026-08-04T07:00:00.000Z",
        scorecard_eligible: true,
      },
      {
        id: legacyTradeId,
        ticker: "MSN",
        mode: "unknown",
        status: "closed",
        timeframe: null,
        system_tags: [],
        setup_tags: [],
        initial_risk_amount: null,
        closed_at: "2026-07-04T07:00:00.000Z",
        scorecard_eligible: false,
        origin: "legacy_migration",
        grouping_status: "deterministic",
        legacy_closed_on: "2026-07-04",
      },
    ] as any,
    fills,
  })

  assert.equal(result.closedCandidateCount, 2)
  assert.equal(result.outcomes.length, 1)
  assert.equal(result.outcomes[0]?.tradeId, liveTradeId)
  assert.equal(result.outcomes[0]?.mode, "live")
  assert.equal(result.excludedClosedTradeCount, 1)
  assert.equal(result.completeness, "partial")
})
