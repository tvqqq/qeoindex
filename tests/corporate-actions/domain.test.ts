import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeCorporateActionNotice,
  normalizeExDateProvenance,
  resolveLineageRootSourceEventId,
} from "../../modules/market/corporate-actions/normalize.ts"

const vhm2021 = {
  source: "vsdc" as const,
  sourceEventId: "144349",
  sourceUrl: "https://vsdc.vn/vi/ad1/144349",
  sourceUpdatedAt: "2021-09-07T14:27:48+07:00",
  ticker: "VHM",
  isin: "VN000000VHM0",
  exchange: "HOSE" as const,
  recordDate: "2021-09-16",
  rawEvidenceHash: "a".repeat(64),
  components: [
    {
      actionType: "cash_dividend" as const,
      cashPerShare: 1500,
      stockRatio: null,
      rightsRatio: null,
      subscriptionPrice: null,
    },
    {
      actionType: "stock_dividend" as const,
      cashPerShare: null,
      stockRatio: "1000:300",
      rightsRatio: null,
      subscriptionPrice: null,
    },
  ],
}

test("QEO-123 normalizes one multi-action VSDC notice into stable ordinal components", () => {
  const result = normalizeCorporateActionNotice(vhm2021, {
    normalizationVersion: "qeo123-v1",
    exDate: {
      date: "2021-09-15",
      basis: "derived",
      derivationMethod: "record_date_previous_verified_trading_session",
      tradingCalendarVersion: "vn-securities-calendar-2018-2026-v1",
    },
  })

  assert.equal(result.rejected.length, 0)
  assert.equal(result.actions.length, 2)
  assert.deepEqual(result.actions.map((row) => row.sourceComponentKey), ["component:0", "component:1"])
  assert.deepEqual(result.actions.map((row) => row.lineageRootSourceEventId), ["144349", "144349"])
  assert.equal(result.actions[0].cashPerShare, 1500)
  assert.equal(result.actions[1].stockRatioNumerator, 1000)
  assert.equal(result.actions[1].stockRatioDenominator, 300)
  assert.equal(result.actions[0].exDate, "2021-09-15")
  assert.equal(result.actions[0].exDateBasis, "derived")
})

test("QEO-123 component identity excludes action type so corrections do not create a second logical row", () => {
  const original = normalizeCorporateActionNotice({
    ...vhm2021,
    sourceEventId: "198978",
    components: [vhm2021.components[0]],
  }, {
    normalizationVersion: "qeo123-v1",
    exDate: null,
  })

  const corrected = normalizeCorporateActionNotice({
    ...vhm2021,
    sourceEventId: "199110",
    components: [{
      actionType: "cash_dividend" as const,
      cashPerShare: 1200,
      stockRatio: null,
      rightsRatio: null,
      subscriptionPrice: null,
    }],
  }, {
    normalizationVersion: "qeo123-v1",
    lineageRootSourceEventId: "198978",
    exDate: null,
  })

  assert.equal(original.actions[0].sourceComponentKey, "component:0")
  assert.equal(corrected.actions[0].sourceComponentKey, "component:0")
  assert.equal(corrected.actions[0].sourceEventId, "199110")
  assert.equal(corrected.actions[0].lineageRootSourceEventId, "198978")
  assert.equal(corrected.actions[0].cashPerShare, 1200)
})

test("QEO-123 amendment lineage fails closed when the referenced source event cannot be resolved", () => {
  assert.equal(resolveLineageRootSourceEventId({
    sourceEventId: "199110",
    amendmentType: "correction",
    referencedSourceEventId: "198978",
  }), "198978")

  assert.equal(resolveLineageRootSourceEventId({
    sourceEventId: "199110",
    amendmentType: "correction",
    referencedSourceEventId: null,
  }), null)
})

test("QEO-123 ex-date provenance fails closed instead of accepting an unproven derived date", () => {
  assert.deepEqual(normalizeExDateProvenance({
    date: "2021-09-15",
    basis: "derived",
    derivationMethod: null,
    tradingCalendarVersion: null,
  }), {
    exDate: null,
    exDateBasis: "unknown",
    exDateDerivationMethod: null,
    tradingCalendarVersion: null,
  })
})

test("QEO-123 rejects incomplete rights terms from canonical actions while retaining component-level evidence", () => {
  const result = normalizeCorporateActionNotice({
    ...vhm2021,
    sourceEventId: "169561",
    ticker: "YTC",
    exchange: "UPCOM",
    components: [{
      actionType: "rights_issue" as const,
      cashPerShare: null,
      stockRatio: null,
      rightsRatio: "100:210",
      subscriptionPrice: null,
    }],
  }, {
    normalizationVersion: "qeo123-v1",
    exDate: null,
  })

  assert.equal(result.actions.length, 0)
  assert.deepEqual(result.rejected, [{
    sourceComponentKey: "component:0",
    reason: "missing_subscription_price",
  }])
})
