import assert from "node:assert/strict"
import test from "node:test"

import { buildFactorRunCandidate } from "../modules/market/corporate-actions/adjustment/engine.ts"
import type { CanonicalFactorAction } from "../modules/market/corporate-actions/adjustment/types.ts"

function cashAction(id: string): CanonicalFactorAction {
  return {
    id,
    ticker: "VHM",
    actionType: "cash_dividend",
    exDate: "2026-06-29",
    cashPerShare: 6_000,
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
  }
}

function candidate(id: string) {
  return buildFactorRunCandidate({
    ticker: "VHM",
    sessions: ["2026-06-26", "2026-06-29"],
    rawDailyByDate: new Map([
      ["2026-06-26", { sessionDate: "2026-06-26", close: 162 }],
    ]),
    actions: [cashAction(id)],
    asOfDate: "2026-06-29",
    engineVersion: "qeo124-v1",
  })
}

test("QEO-124 lineage is portable across databases with different random corporate-action UUIDs", () => {
  const local = candidate("00000000-0000-4000-8000-000000000124")
  const production = candidate("ffffffff-ffff-4fff-8fff-ffffffffffff")

  assert.equal(local.status, "candidate")
  assert.equal(production.status, "candidate")
  assert.equal(local.transitions[0].stepPriceFactor, 26 / 27)
  assert.equal(production.transitions[0].stepPriceFactor, 26 / 27)

  assert.notDeepEqual(local.transitions[0].corporateActionIds, production.transitions[0].corporateActionIds)
  assert.equal(local.transitions[0].eventLineageHash, production.transitions[0].eventLineageHash)
  assert.equal(local.eventLineageHash, production.eventLineageHash)
  assert.equal(local.factorVersion, production.factorVersion)
})
