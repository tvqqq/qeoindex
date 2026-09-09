import assert from "node:assert/strict"
import test from "node:test"

import { deriveDrawdownAnalytics } from "../../modules/portfolio/performance/drawdown.ts"
import type { EquityPoint } from "../../modules/portfolio/risk-engine/types.ts"

function point(key: string, equityVnd: number, kind: EquityPoint["kind"] = "daily"): EquityPoint {
  return { key, kind, equityVnd, externalFlowVnd: 0, status: "complete", missingTickers: [] }
}

test("drawdown episodes keep a fixed peak until recovery", () => {
  const result = deriveDrawdownAnalytics([
    point("baseline", 100, "baseline"),
    point("2026-09-01", 90),
    point("2026-09-02", 95),
    point("2026-09-03", 105),
    point("2026-09-04", 84),
    point("2026-09-05", 110),
  ])

  assert.equal(result.completeness, "complete")
  assert.equal(result.episodes.length, 2)
  assert.deepEqual(result.episodes[0], {
    peakKey: "baseline",
    startKey: "2026-09-01",
    troughKey: "2026-09-01",
    recoveryKey: "2026-09-03",
    peakEquityVnd: 100,
    troughEquityVnd: 90,
    depthPercent: 10,
    recovered: true,
  })
  assert.deepEqual(result.episodes[1], {
    peakKey: "2026-09-03",
    startKey: "2026-09-04",
    troughKey: "2026-09-04",
    recoveryKey: "2026-09-05",
    peakEquityVnd: 105,
    troughEquityVnd: 84,
    depthPercent: 20,
    recovered: true,
  })
  assert.equal(result.maxDrawdownPercent, 20)
  assert.equal(result.averageDrawdownPercent, 15)
})

test("unrecovered current episode participates in max and average drawdown", () => {
  const result = deriveDrawdownAnalytics([
    point("baseline", 100, "baseline"),
    point("2026-09-01", 90),
    point("2026-09-02", 95),
  ])

  assert.equal(result.episodes.length, 1)
  assert.equal(result.episodes[0]?.recovered, false)
  assert.equal(result.episodes[0]?.recoveryKey, null)
  assert.equal(result.maxDrawdownPercent, 10)
  assert.equal(result.averageDrawdownPercent, 10)
})

test("one incomplete point fails closed for the analyzed range", () => {
  const result = deriveDrawdownAnalytics([
    point("baseline", 100, "baseline"),
    { key: "2026-09-01", kind: "daily", equityVnd: null, externalFlowVnd: 0, status: "incomplete", missingTickers: ["FPT"] },
    point("2026-09-02", 110),
  ])

  assert.equal(result.completeness, "insufficient")
  assert.equal(result.maxDrawdownPercent, null)
  assert.equal(result.averageDrawdownPercent, null)
  assert.deepEqual(result.episodes, [])
})

test("complete monotonic equity observes zero max drawdown but has no episode average", () => {
  const result = deriveDrawdownAnalytics([
    point("baseline", 100, "baseline"),
    point("2026-09-01", 101),
    point("2026-09-02", 102),
  ])

  assert.equal(result.completeness, "complete")
  assert.equal(result.maxDrawdownPercent, 0)
  assert.equal(result.averageDrawdownPercent, null)
  assert.deepEqual(result.episodes, [])
})
