import assert from "node:assert/strict"
import test from "node:test"

import { buildBenchmarkComparison } from "../../modules/portfolio/performance/benchmark.ts"
import type { EquityPoint } from "../../modules/portfolio/risk-engine/types.ts"

function equity(
  key: string,
  equityVnd: number | null,
  status: "complete" | "incomplete" = "complete",
  kind: EquityPoint["kind"] = "daily",
): EquityPoint {
  return {
    key,
    kind,
    equityVnd,
    externalFlowVnd: 0,
    status,
    missingTickers: status === "complete" ? [] : ["FPT"],
  }
}

test("benchmark starts at first common complete daily date with independent baselines", () => {
  const result = buildBenchmarkComparison({
    equityPoints: [
      equity("2026-09-01", null, "incomplete"),
      equity("2026-09-02", 100_000_000),
      equity("2026-09-03", 110_000_000),
      equity("2026-09-03:current", 112_000_000, "complete", "current"),
    ],
    vnindexPoints: [
      { date: "2026-09-01", close: 1_000 },
      { date: "2026-09-02", close: 1_200 },
      { date: "2026-09-03", close: 1_260 },
    ],
  })

  assert.equal(result.completeness, "complete")
  assert.deepEqual(result.points, [
    { date: "2026-09-02", portfolioReturnPercent: 0, vnindexReturnPercent: 0, alphaPercent: 0 },
    { date: "2026-09-03", portfolioReturnPercent: 10, vnindexReturnPercent: 5, alphaPercent: 5 },
  ])
  assert.equal(result.portfolioReturnPercent, 10)
  assert.equal(result.vnindexReturnPercent, 5)
  assert.equal(result.alphaPercent, 5)
})

test("non-positive benchmark baselines fail closed instead of fabricating zero", () => {
  const result = buildBenchmarkComparison({
    equityPoints: [equity("2026-09-02", 100_000_000)],
    vnindexPoints: [{ date: "2026-09-02", close: 0 }],
  })

  assert.equal(result.completeness, "insufficient")
  assert.equal(result.portfolioReturnPercent, null)
  assert.equal(result.vnindexReturnPercent, null)
  assert.equal(result.alphaPercent, null)
  assert.deepEqual(result.points, [])
})

test("no common complete date returns explicit unavailable metrics", () => {
  const result = buildBenchmarkComparison({
    equityPoints: [equity("2026-09-02", 100_000_000)],
    vnindexPoints: [{ date: "2026-09-03", close: 1_200 }],
  })

  assert.equal(result.completeness, "insufficient")
  assert.match(result.reason ?? "", /common/i)
  assert.equal(result.portfolioReturnPercent, null)
  assert.equal(result.vnindexReturnPercent, null)
  assert.equal(result.alphaPercent, null)
  assert.deepEqual(result.points, [])
})
