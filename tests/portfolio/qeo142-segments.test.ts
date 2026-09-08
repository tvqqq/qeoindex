import assert from "node:assert/strict"
import test from "node:test"

import { buildPerformanceSegments } from "../../modules/portfolio/performance/segments.ts"
import type { ClosedTradeOutcome } from "../../modules/portfolio/performance/types.ts"

function outcome(overrides: Partial<ClosedTradeOutcome> = {}): ClosedTradeOutcome {
  return {
    tradeId: "t1",
    ticker: "FPT",
    mode: "live",
    timeframe: "swing",
    systemTags: ["trend"],
    setupTags: ["breakout"],
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

test("one multi-tag Trade belongs to multiple non-additive tag segments", () => {
  const segments = buildPerformanceSegments([
    outcome({ setupTags: ["breakout", "pullback"] }),
  ], "live")

  const setup = segments.filter((segment) => segment.dimension === "setup")
  assert.deepEqual(setup.map((segment) => segment.key), ["breakout", "pullback"])
  assert.deepEqual(setup.map((segment) => segment.sampleSize), [1, 1])
})

test("population filtering occurs before segmentation", () => {
  const rows = [
    outcome({ tradeId: "live", mode: "live", setupTags: ["same"] }),
    outcome({ tradeId: "paper", mode: "paper", setupTags: ["same"], closedAt: "2026-09-02T08:00:00Z" }),
  ]

  const live = buildPerformanceSegments(rows, "live").find((segment) => segment.dimension === "setup" && segment.key === "same")
  const combined = buildPerformanceSegments(rows, "combined").find((segment) => segment.dimension === "setup" && segment.key === "same")
  assert.equal(live?.sampleSize, 1)
  assert.equal(combined?.sampleSize, 2)
})

test("small samples are explicit and Payoff is unavailable without both sides", () => {
  const segment = buildPerformanceSegments([
    outcome({ setupTags: ["breakout"] }),
  ], "live").find((row) => row.dimension === "setup" && row.key === "breakout")

  assert.equal(segment?.sampleSize, 1)
  assert.equal(segment?.smallSample, true)
  assert.equal(segment?.winRatioPercent, 100)
  assert.equal(segment?.payoffRatio, null)
  assert.equal(segment?.netPnlVnd, 1_000_000)
})

test("segments reuse full winner and loser population ratios", () => {
  const segments = buildPerformanceSegments([
    outcome({ tradeId: "w", systemTags: ["trend"], netPnlVnd: 2_000_000, grossPnlVnd: 2_100_000 }),
    outcome({ tradeId: "l", systemTags: ["trend"], closedAt: "2026-09-02T08:00:00Z", netPnlVnd: -1_000_000, grossPnlVnd: -900_000, outcome: "loser" }),
  ], "live")
  const trend = segments.find((row) => row.dimension === "system" && row.key === "trend")

  assert.equal(trend?.sampleSize, 2)
  assert.equal(trend?.winRatioPercent, 50)
  assert.equal(trend?.payoffRatio, 2)
  assert.equal(trend?.netPnlVnd, 1_000_000)
})

test("segment output is deterministic by dimension then key", () => {
  const segments = buildPerformanceSegments([
    outcome({
      systemTags: ["zeta", "alpha"],
      setupTags: ["setup-b", "setup-a"],
      behaviorTags: ["fomo"],
      mistakeTags: ["late"],
    }),
  ], "live")

  const pairs = segments.map((segment) => `${segment.dimension}:${segment.key}`)
  assert.deepEqual(pairs, [...pairs].sort((a, b) => a.localeCompare(b)))
})
