import assert from "node:assert/strict"
import test from "node:test"

import { buildTradingScorecard } from "../../modules/portfolio/performance/scorecard.ts"
import type { ClosedTradeOutcome } from "../../modules/portfolio/performance/types.ts"

function outcome(overrides: Partial<ClosedTradeOutcome> = {}): ClosedTradeOutcome {
  return {
    tradeId: "t1",
    ticker: "FPT",
    mode: "live",
    timeframe: "swing",
    systemTags: [],
    setupTags: [],
    behaviorTags: [],
    mistakeTags: [],
    closedAt: "2026-09-01T08:00:00Z",
    grossPnlVnd: 1_100_000,
    totalFeesVnd: 100_000,
    netPnlVnd: 1_000_000,
    pnlPercent: 1,
    outcome: "winner",
    rMultiple: 1,
    explicitStopOut: false,
    ...overrides,
  }
}

test("Win Payoff Commission and documented PnL formulas use canonical closed Trades", () => {
  const card = buildTradingScorecard({
    population: "live",
    initialCapitalVnd: 100_000_000,
    outcomes: [
      outcome({ tradeId: "w", grossPnlVnd: 2_100_000, totalFeesVnd: 100_000, netPnlVnd: 2_000_000, outcome: "winner" }),
      outcome({ tradeId: "l", closedAt: "2026-09-02T08:00:00Z", grossPnlVnd: -900_000, totalFeesVnd: 100_000, netPnlVnd: -1_000_000, outcome: "loser" }),
    ],
  })

  assert.equal(card.eligibleTradeCount, 2)
  assert.equal(card.winnerCount, 1)
  assert.equal(card.loserCount, 1)
  assert.equal(card.grossProfitVnd, 2_100_000)
  assert.equal(card.grossLossVnd, -900_000)
  assert.equal(card.commissionVnd, 200_000)
  assert.equal(card.netPnlVnd, 1_000_000)
  assert.equal(card.winRatioPercent.value, 50)
  assert.equal(card.payoffRatio.value, 2)
  assert.equal(card.commissionRatio.value, 200_000 / 2_100_000)
  assert.equal(card.documentedPnlPercent.value, 1)
  assert.equal(card.optimalF.value, 0.25)
})

test("empty and one-sided samples are explicit N A states", () => {
  const empty = buildTradingScorecard({ outcomes: [], population: "live", initialCapitalVnd: 100_000_000 })
  assert.equal(empty.winRatioPercent.value, null)
  assert.equal(empty.payoffRatio.value, null)
  assert.equal(empty.commissionRatio.value, null)
  assert.equal(empty.largestConsecutiveLosses.value, null)
  assert.equal(empty.averageConsecutiveLosses.value, null)
  assert.equal(empty.rolling25.status, "insufficient")

  const winnersOnly = buildTradingScorecard({
    outcomes: [outcome()],
    population: "live",
    initialCapitalVnd: 100_000_000,
  })
  assert.equal(winnersOnly.payoffRatio.value, null)
  assert.equal(winnersOnly.optimalF.value, null)
})

test("Commission Ratio is N A when gross profit is not positive", () => {
  const card = buildTradingScorecard({
    outcomes: [
      outcome({ tradeId: "l", grossPnlVnd: -900_000, totalFeesVnd: 100_000, netPnlVnd: -1_000_000, outcome: "loser" }),
    ],
    population: "live",
    initialCapitalVnd: 100_000_000,
  })
  assert.equal(card.grossProfitVnd, 0)
  assert.equal(card.commissionRatio.value, null)
})

test("loss runs use deterministic close order and breakeven or winner breaks a run", () => {
  const seq: Array<ClosedTradeOutcome["outcome"]> = ["loser", "loser", "winner", "loser", "loser", "loser"]
  const outcomes = seq.map((kind, index) => outcome({
    tradeId: `t${index}`,
    closedAt: `2026-09-0${index + 1}T08:00:00Z`,
    grossPnlVnd: kind === "loser" ? -900_000 : 1_100_000,
    totalFeesVnd: 100_000,
    netPnlVnd: kind === "loser" ? -1_000_000 : 1_000_000,
    outcome: kind,
  }))

  const card = buildTradingScorecard({ outcomes, population: "live", initialCapitalVnd: 100_000_000 })
  assert.equal(card.largestConsecutiveLosses.value, 3)
  assert.equal(card.averageConsecutiveLosses.value, 2.5)

  const withBreakeven = buildTradingScorecard({
    outcomes: [
      outcome({ tradeId: "a", netPnlVnd: -1, grossPnlVnd: -1, totalFeesVnd: 0, outcome: "loser" }),
      outcome({ tradeId: "b", closedAt: "2026-09-02T08:00:00Z", netPnlVnd: 0, grossPnlVnd: 0, totalFeesVnd: 0, outcome: "breakeven" }),
      outcome({ tradeId: "c", closedAt: "2026-09-03T08:00:00Z", netPnlVnd: -1, grossPnlVnd: -1, totalFeesVnd: 0, outcome: "loser" }),
    ],
    population: "live",
    initialCapitalVnd: 100,
  })
  assert.equal(withBreakeven.largestConsecutiveLosses.value, 1)
  assert.equal(withBreakeven.averageConsecutiveLosses.value, 1)
})

test("rolling 25 uses the latest deterministic 25 Trades", () => {
  const outcomes = Array.from({ length: 30 }, (_, index) => outcome({
    tradeId: `t${String(index).padStart(2, "0")}`,
    closedAt: `2026-08-${String(index + 1).padStart(2, "0")}T08:00:00Z`,
    grossPnlVnd: index < 5 ? -9_000_000 : 1_000_000,
    totalFeesVnd: 0,
    netPnlVnd: index < 5 ? -9_000_000 : 1_000_000,
    outcome: index < 5 ? "loser" : "winner",
  }))

  const card = buildTradingScorecard({ outcomes, population: "live", initialCapitalVnd: 100_000_000 })
  assert.equal(card.rolling25.sampleSize, 25)
  assert.equal(card.rolling25.isFullWindow, true)
  assert.equal(card.rolling25.netPnlVnd, 25_000_000)
  assert.equal(card.rolling25.status, "positive")
})

test("live paper and combined populations never mix implicitly", () => {
  const outcomes = [
    outcome({ tradeId: "live", mode: "live" }),
    outcome({ tradeId: "paper", mode: "paper", closedAt: "2026-09-02T08:00:00Z" }),
  ]

  assert.equal(buildTradingScorecard({ outcomes, population: "live", initialCapitalVnd: 1 }).eligibleTradeCount, 1)
  assert.equal(buildTradingScorecard({ outcomes, population: "paper", initialCapitalVnd: 1 }).eligibleTradeCount, 1)
  assert.equal(buildTradingScorecard({ outcomes, population: "combined", initialCapitalVnd: 1 }).eligibleTradeCount, 2)
})
