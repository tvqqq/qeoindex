import assert from "node:assert/strict"
import test from "node:test"

import { buildBenchmarkComparison } from "../../modules/portfolio/performance/benchmark.ts"
import { deriveDrawdownAnalytics } from "../../modules/portfolio/performance/drawdown.ts"
import { buildAccountLedgers } from "../../modules/portfolio/performance/ledgers.ts"
import type { EquityPoint } from "../../modules/portfolio/risk-engine/types.ts"

function point(
  key: string,
  equityVnd: number,
  flowAdjustedEquityVnd: number,
  fundingHistoryStatus: "known" | "legacy_unrecorded" = "known",
): EquityPoint {
  const cumulativeExternalFlowVnd = equityVnd - flowAdjustedEquityVnd
  return {
    key,
    kind: key === "baseline" ? "baseline" : "daily",
    equityVnd,
    flowAdjustedEquityVnd,
    externalFlowVnd: key === "2026-09-02" ? cumulativeExternalFlowVnd : 0,
    cumulativeExternalFlowVnd,
    fundingHistoryStatus,
    status: "complete",
    missingTickers: [],
  }
}

test("account ledgers neutralize a deposit but preserve later performance", () => {
  const ledgers = buildAccountLedgers([
    point("baseline", 100_000_000, 100_000_000),
    point("2026-09-01", 100_000_000, 100_000_000),
    point("2026-09-02", 120_000_000, 100_000_000),
    point("2026-09-03", 132_000_000, 112_000_000),
  ])

  const depositDay = ledgers.daily.find((row) => row.key === "2026-09-02")
  const gainDay = ledgers.daily.find((row) => row.key === "2026-09-03")
  assert.equal(depositDay?.returnPercent, 0)
  assert.equal(depositDay?.worstDrawdownPercent, 0)
  assert.equal(gainDay?.returnPercent, 12)
})

test("drawdown ignores a withdrawal but preserves a later trading loss", () => {
  const analytics = deriveDrawdownAnalytics([
    point("baseline", 100_000_000, 100_000_000),
    point("2026-09-01", 100_000_000, 100_000_000),
    point("2026-09-02", 80_000_000, 100_000_000),
    point("2026-09-03", 70_000_000, 90_000_000),
  ])

  assert.equal(analytics.maxDrawdownPercent, 10)
})

test("benchmark uses flow-adjusted portfolio equity", () => {
  const comparison = buildBenchmarkComparison({
    equityPoints: [
      point("2026-09-01", 100_000_000, 100_000_000),
      point("2026-09-02", 120_000_000, 100_000_000),
    ],
    vnindexPoints: [
      { date: "2026-09-01", close: 1_700 },
      { date: "2026-09-02", close: 1_700 },
    ],
  })

  assert.equal(comparison.portfolioReturnPercent, 0)
  assert.equal(comparison.alphaPercent, 0)
})

test("legacy-unrecorded funding makes account performance insufficient", () => {
  const points = [
    point("baseline", 100_000_000, 100_000_000, "legacy_unrecorded"),
    point("2026-09-01", 110_000_000, 110_000_000, "legacy_unrecorded"),
  ]

  const ledgers = buildAccountLedgers(points)
  const drawdown = deriveDrawdownAnalytics(points)
  const benchmark = buildBenchmarkComparison({
    equityPoints: points,
    vnindexPoints: [{ date: "2026-09-01", close: 1_700 }],
  })

  assert.equal(ledgers.daily[0]?.completeness, "insufficient")
  assert.equal(drawdown.completeness, "insufficient")
  assert.equal(benchmark.completeness, "insufficient")
})
