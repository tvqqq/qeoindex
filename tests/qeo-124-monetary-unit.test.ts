import assert from "node:assert/strict"
import test from "node:test"

import { computeStepAdjustment } from "../modules/market/corporate-actions/adjustment/formulas.ts"
import type { CanonicalFactorAction } from "../modules/market/corporate-actions/adjustment/types.ts"

function action(overrides: Partial<CanonicalFactorAction>): CanonicalFactorAction {
  return {
    id: "00000000-0000-4000-8000-000000000124",
    ticker: "VHM",
    actionType: "cash_dividend",
    exDate: "2026-06-29",
    cashPerShare: null,
    stockRatioNumerator: null,
    stockRatioDenominator: null,
    rightsRatioNumerator: null,
    rightsRatioDenominator: null,
    subscriptionPrice: null,
    normalizationVersion: "qeo123-v1",
    rawEvidenceHash: "a".repeat(64),
    source: "vsdc",
    lineageRootSourceEventId: "197086",
    sourceComponentKey: "component:0",
    ...overrides,
  }
}

test("QEO-124 converts canonical VND cash terms to the canonical kilo-VND Daily price scale", () => {
  const result = computeStepAdjustment({
    ticker: "VHM",
    exDate: "2026-06-29",
    previousRawClose: 81,
    events: [action({ cashPerShare: 6_000 })],
  })

  assert.equal(result.theoreticalExPrice, 75)
  assert.equal(result.stepPriceFactor, 75 / 81)
  assert.equal(result.stepVolumeFactor, 1)
})

test("QEO-124 converts VND rights subscription price before TERP arithmetic", () => {
  const result = computeStepAdjustment({
    ticker: "VHM",
    exDate: "2026-06-29",
    previousRawClose: 100,
    events: [action({
      actionType: "rights_issue",
      cashPerShare: null,
      rightsRatioNumerator: 4,
      rightsRatioDenominator: 1,
      subscriptionPrice: 60_000,
    })],
  })

  assert.equal(result.theoreticalExPrice, 92)
  assert.equal(result.stepPriceFactor, 0.92)
  assert.equal(result.stepVolumeFactor, 1)
})
