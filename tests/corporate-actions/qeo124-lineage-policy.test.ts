import assert from "node:assert/strict"
import test from "node:test"

import { buildFactorRunCandidate } from "../../modules/market/corporate-actions/adjustment/engine.ts"
import type { CanonicalFactorAction } from "../../modules/market/corporate-actions/adjustment/types.ts"

const cashAction: CanonicalFactorAction = {
  id: "00000000-0000-4000-8000-000000000201",
  ticker: "AAA",
  actionType: "cash_dividend",
  exDate: "2026-01-10",
  cashPerShare: 10,
  stockRatioNumerator: null,
  stockRatioDenominator: null,
  rightsRatioNumerator: null,
  rightsRatioDenominator: null,
  subscriptionPrice: null,
  normalizationVersion: "qeo123-v1",
  rawEvidenceHash: "a".repeat(64),
  source: "vsdc",
  lineageRootSourceEventId: "2001",
  sourceComponentKey: "component:0",
}

function build(asOfDate: string) {
  return buildFactorRunCandidate({
    ticker: "AAA",
    sessions: ["2026-01-09", "2026-01-10", "2026-01-12"],
    rawDailyByDate: new Map([
      ["2026-01-09", { sessionDate: "2026-01-09", close: 100 }],
      ["2026-01-10", { sessionDate: "2026-01-10", close: 90 }],
      ["2026-01-12", { sessionDate: "2026-01-12", close: 91 }],
    ]),
    actions: [cashAction],
    asOfDate,
    engineVersion: "qeo124-v1",
  })
}

test("QEO-124 advancing as-of date without new effective evidence does not churn factor lineage", () => {
  const onEventDate = build("2026-01-10")
  const later = build("2026-01-12")

  assert.equal(onEventDate.status, "candidate")
  assert.equal(later.status, "candidate")
  assert.deepEqual(later.transitions, onEventDate.transitions)
  assert.equal(later.eventLineageHash, onEventDate.eventLineageHash)
  assert.equal(later.factorVersion, onEventDate.factorVersion)
})
