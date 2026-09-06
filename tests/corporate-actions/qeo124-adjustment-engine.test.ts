import assert from "node:assert/strict"
import test from "node:test"

import { AdjustmentFactorError, computeStepAdjustment } from "../../modules/market/corporate-actions/adjustment/formulas.ts"
import type { CanonicalFactorAction } from "../../modules/market/corporate-actions/adjustment/types.ts"

function action(overrides: Partial<CanonicalFactorAction>): CanonicalFactorAction {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    ticker: "AAA",
    actionType: "cash_dividend",
    exDate: "2026-01-10",
    cashPerShare: null,
    stockRatioNumerator: null,
    stockRatioDenominator: null,
    rightsRatioNumerator: null,
    rightsRatioDenominator: null,
    subscriptionPrice: null,
    normalizationVersion: "qeo123-v1",
    rawEvidenceHash: "a".repeat(64),
    source: "vsdc",
    lineageRootSourceEventId: "1001",
    sourceComponentKey: "component:0",
    ...overrides,
  }
}

function eventSet(events: CanonicalFactorAction[], previousRawClose = 100) {
  return {
    ticker: "AAA",
    exDate: "2026-01-10",
    previousRawClose,
    events,
  }
}

function closeTo(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ≈ ${expected}`)
}

test("QEO-124 identity event set preserves price and volume exactly", () => {
  const result = computeStepAdjustment(eventSet([]))
  assert.equal(result.theoreticalExPrice, 100)
  assert.equal(result.stepPriceFactor, 1)
  assert.equal(result.stepVolumeFactor, 1)
  assert.deepEqual(result.corporateActionIds, [])
})

test("QEO-124 cash dividend changes price basis but never historical volume", () => {
  const result = computeStepAdjustment(eventSet([
    action({ cashPerShare: 10 }),
  ]))
  assert.equal(result.theoreticalExPrice, 90)
  assert.equal(result.stepPriceFactor, 0.9)
  assert.equal(result.stepVolumeFactor, 1)

  assert.throws(
    () => computeStepAdjustment(eventSet([action({ cashPerShare: 100 })])),
    (error: unknown) => error instanceof AdjustmentFactorError && error.code === "NON_POSITIVE_THEORETICAL_VALUE",
  )
})

test("QEO-124 stock dividend and bonus ratios use existing:additional semantics", () => {
  const oneForOne = computeStepAdjustment(eventSet([
    action({ actionType: "stock_dividend", stockRatioNumerator: 1, stockRatioDenominator: 1 }),
  ]))
  assert.equal(oneForOne.theoreticalExPrice, 50)
  assert.equal(oneForOne.stepPriceFactor, 0.5)
  assert.equal(oneForOne.stepVolumeFactor, 2)

  const thirtyPercent = computeStepAdjustment(eventSet([
    action({ actionType: "bonus_issue", stockRatioNumerator: 100, stockRatioDenominator: 30 }),
  ]))
  closeTo(thirtyPercent.theoreticalExPrice, 100 / 1.3)
  closeTo(thirtyPercent.stepPriceFactor, 1 / 1.3)
  closeTo(thirtyPercent.stepVolumeFactor, 1.3)
})

test("QEO-124 split and consolidation ratios use old:new-total semantics", () => {
  const split = computeStepAdjustment(eventSet([
    action({ actionType: "stock_split", stockRatioNumerator: 1, stockRatioDenominator: 2 }),
  ]))
  assert.equal(split.theoreticalExPrice, 50)
  assert.equal(split.stepPriceFactor, 0.5)
  assert.equal(split.stepVolumeFactor, 2)

  const consolidation = computeStepAdjustment(eventSet([
    action({ actionType: "stock_split", stockRatioNumerator: 2, stockRatioDenominator: 1 }),
  ]))
  assert.equal(consolidation.theoreticalExPrice, 200)
  assert.equal(consolidation.stepPriceFactor, 2)
  assert.equal(consolidation.stepVolumeFactor, 0.5)

  assert.throws(
    () => computeStepAdjustment(eventSet([
      action({ id: "00000000-0000-4000-8000-000000000010", actionType: "stock_split", stockRatioNumerator: 1, stockRatioDenominator: 2 }),
      action({ id: "00000000-0000-4000-8000-000000000011", actionType: "stock_split", stockRatioNumerator: 1, stockRatioDenominator: 2 }),
    ])),
    (error: unknown) => error instanceof AdjustmentFactorError && error.code === "UNSUPPORTED_SPLIT_COMPOSITION",
  )
})

test("QEO-124 rights issue affects TERP price but not historical volume in engine v1", () => {
  const result = computeStepAdjustment(eventSet([
    action({
      actionType: "rights_issue",
      rightsRatioNumerator: 4,
      rightsRatioDenominator: 1,
      subscriptionPrice: 60,
    }),
  ]))
  assert.equal(result.theoreticalExPrice, 92)
  assert.equal(result.stepPriceFactor, 0.92)
  assert.equal(result.stepVolumeFactor, 1)
})

test("QEO-124 same-date cash stock and rights are one order-independent event set", () => {
  const events = [
    action({ id: "00000000-0000-4000-8000-000000000003", actionType: "rights_issue", rightsRatioNumerator: 4, rightsRatioDenominator: 1, subscriptionPrice: 60, sourceComponentKey: "component:2" }),
    action({ id: "00000000-0000-4000-8000-000000000001", cashPerShare: 10, sourceComponentKey: "component:0" }),
    action({ id: "00000000-0000-4000-8000-000000000002", actionType: "stock_dividend", stockRatioNumerator: 4, stockRatioDenominator: 1, sourceComponentKey: "component:1" }),
  ]
  const forward = computeStepAdjustment(eventSet(events))
  const shuffled = computeStepAdjustment(eventSet([events[1], events[2], events[0]]))

  assert.deepEqual(forward, shuffled)
  assert.deepEqual(forward.corporateActionIds, [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ])
  closeTo(forward.theoreticalExPrice, 105 / 1.5)
  closeTo(forward.stepPriceFactor, 0.7)
  closeTo(forward.stepVolumeFactor, 1.25)
})

test("QEO-124 malformed or contradictory action inputs fail closed", () => {
  const invalidCases: Array<[string, () => unknown]> = [
    ["INVALID_REFERENCE_CLOSE", () => computeStepAdjustment(eventSet([], 0))],
    ["EVENT_TICKER_MISMATCH", () => computeStepAdjustment(eventSet([action({ ticker: "BBB" })]))],
    ["EVENT_DATE_MISMATCH", () => computeStepAdjustment(eventSet([action({ exDate: "2026-01-11" })]))],
    ["INVALID_STOCK_RATIO", () => computeStepAdjustment(eventSet([action({ actionType: "stock_dividend", stockRatioNumerator: 0, stockRatioDenominator: 1 })]))],
    ["MISSING_SUBSCRIPTION_PRICE", () => computeStepAdjustment(eventSet([action({ actionType: "rights_issue", rightsRatioNumerator: 4, rightsRatioDenominator: 1 })]))],
    ["CONTRADICTORY_TERMS", () => computeStepAdjustment(eventSet([action({ cashPerShare: 10, stockRatioNumerator: 1, stockRatioDenominator: 1 })]))],
  ]

  for (const [code, run] of invalidCases) {
    assert.throws(run, (error: unknown) => error instanceof AdjustmentFactorError && error.code === code, code)
  }
})
