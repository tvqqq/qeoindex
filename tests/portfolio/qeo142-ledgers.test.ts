import assert from "node:assert/strict"
import test from "node:test"

import { buildAccountLedgers, buildTradingLedgers } from "../../modules/portfolio/performance/ledgers.ts"
import type { ClosedTradeOutcome } from "../../modules/portfolio/performance/types.ts"
import type { EquityPoint } from "../../modules/portfolio/risk-engine/types.ts"

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

function equity(
  key: string,
  equityVnd: number | null,
  kind: EquityPoint["kind"] = "daily",
  status: EquityPoint["status"] = equityVnd == null ? "incomplete" : "complete",
): EquityPoint {
  return {
    key,
    kind,
    equityVnd,
    status,
    missingTickers: status === "incomplete" ? ["FPT"] : [],
  }
}

test("weekly Trade assignment is Monday through Sunday in Asia Ho Chi Minh", () => {
  const ledgers = buildTradingLedgers([
    outcome({ tradeId: "sun", closedAt: "2026-09-06T16:30:00Z" }),
    outcome({ tradeId: "mon", closedAt: "2026-09-06T17:30:00Z" }),
  ], "live")

  assert.deepEqual(ledgers.weekly.map((row) => row.key), ["2026-08-31", "2026-09-07"])
  assert.deepEqual(ledgers.weekly.map((row) => row.tradeCount), [1, 1])
})

test("trading ledgers reconcile period totals and running net PnL without fill counting", () => {
  const ledgers = buildTradingLedgers([
    outcome({ tradeId: "w1", closedAt: "2026-09-01T08:00:00Z", netPnlVnd: 2_000_000, grossPnlVnd: 2_100_000, totalFeesVnd: 100_000 }),
    outcome({ tradeId: "l1", closedAt: "2026-09-02T08:00:00Z", netPnlVnd: -1_000_000, grossPnlVnd: -900_000, totalFeesVnd: 100_000, outcome: "loser" }),
  ], "live")

  assert.equal(ledgers.daily.length, 2)
  assert.deepEqual(ledgers.daily.map((row) => row.netPnlVnd), [2_000_000, -1_000_000])
  assert.deepEqual(ledgers.daily.map((row) => row.runningNetPnlVnd), [2_000_000, 1_000_000])
  assert.equal(ledgers.monthly[0]?.tradeCount, 2)
  assert.equal(ledgers.monthly[0]?.grossProfitVnd, 2_100_000)
  assert.equal(ledgers.monthly[0]?.grossLossVnd, -900_000)
  assert.equal(ledgers.monthly[0]?.commissionVnd, 200_000)
  assert.equal(ledgers.monthly[0]?.netPnlVnd, 1_000_000)
})

test("live paper and combined trading ledgers remain isolated", () => {
  const rows = [
    outcome({ tradeId: "live", mode: "live" }),
    outcome({ tradeId: "paper", mode: "paper", closedAt: "2026-09-02T08:00:00Z" }),
  ]

  assert.equal(buildTradingLedgers(rows, "live").monthly[0]?.tradeCount, 1)
  assert.equal(buildTradingLedgers(rows, "paper").monthly[0]?.tradeCount, 1)
  assert.equal(buildTradingLedgers(rows, "combined").monthly[0]?.tradeCount, 2)
})

test("first account period uses baseline then later periods use prior complete equity", () => {
  const ledgers = buildAccountLedgers([
    equity("baseline", 100_000_000, "baseline"),
    equity("2026-09-01", 105_000_000),
    equity("2026-09-02", 99_000_000),
  ])

  assert.equal(ledgers.daily[0]?.key, "2026-09-01")
  assert.equal(ledgers.daily[0]?.startEquityVnd, 100_000_000)
  assert.equal(ledgers.daily[0]?.endEquityVnd, 105_000_000)
  assert.equal(ledgers.daily[0]?.returnPercent, 5)

  assert.equal(ledgers.daily[1]?.startEquityVnd, 105_000_000)
  assert.equal(ledgers.daily[1]?.endEquityVnd, 99_000_000)
  assert.equal(ledgers.daily[1]?.worstDrawdownPercent, (6_000_000 / 105_000_000) * 100)

  assert.equal(ledgers.monthly[0]?.startEquityVnd, 100_000_000)
  assert.equal(ledgers.monthly[0]?.endEquityVnd, 99_000_000)
  assert.equal(ledgers.monthly[0]?.returnPercent, -1)
})

test("current point on the same date is the account period end", () => {
  const ledgers = buildAccountLedgers([
    equity("baseline", 100_000_000, "baseline"),
    equity("2026-09-01", 101_000_000),
    equity("2026-09-01:current", 102_000_000, "current"),
  ])

  assert.equal(ledgers.daily.length, 1)
  assert.equal(ledgers.daily[0]?.endEquityVnd, 102_000_000)
  assert.equal(ledgers.daily[0]?.returnPercent, 2)
})

test("incomplete continuity fails closed instead of skipping the missing equity point", () => {
  const ledgers = buildAccountLedgers([
    equity("baseline", 100_000_000, "baseline"),
    equity("2026-09-01", 100_000_000),
    equity("2026-09-02", null),
    equity("2026-09-03", 110_000_000),
  ])

  const sep3 = ledgers.daily.find((row) => row.key === "2026-09-03")
  assert.equal(sep3?.completeness, "insufficient")
  assert.equal(sep3?.returnPercent, null)
  assert.equal(sep3?.worstDrawdownPercent, null)

  assert.equal(ledgers.monthly[0]?.completeness, "insufficient")
  assert.equal(ledgers.monthly[0]?.returnPercent, null)
})

test("period drawdown carries the all-time peak from prior history", () => {
  const ledgers = buildAccountLedgers([
    equity("baseline", 100_000_000, "baseline"),
    equity("2026-08-31", 120_000_000),
    equity("2026-09-01", 114_000_000),
    equity("2026-09-02", 108_000_000),
  ])

  assert.equal(ledgers.monthly[1]?.key, "2026-09")
  assert.equal(ledgers.monthly[1]?.worstDrawdownPercent, 10)
})
