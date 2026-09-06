import assert from "node:assert/strict"
import test from "node:test"

import { persistCorporateActionNotice } from "../../modules/market/corporate-actions/store.ts"
import { readCorporateActions } from "../../modules/market/corporate-actions/read-model.ts"
import type { NormalizedCorporateAction } from "../../modules/market/corporate-actions/contract.ts"

const action: NormalizedCorporateAction = {
  ticker: "VHM",
  isin: "VN000000VHM0",
  exchange: "HOSE",
  actionType: "cash_dividend",
  status: "active",
  recordDate: "2026-06-30",
  exDate: "2026-06-29",
  exDateBasis: "derived",
  exDateDerivationMethod: "record_date_previous_verified_trading_session",
  tradingCalendarVersion: "vn-securities-calendar-2018-2026-v1",
  cashPerShare: 6000,
  stockRatioNumerator: null,
  stockRatioDenominator: null,
  rightsRatioNumerator: null,
  rightsRatioDenominator: null,
  subscriptionPrice: null,
  source: "vsdc",
  sourceEventId: "197086",
  lineageRootSourceEventId: "197086",
  sourceComponentKey: "component:0",
  sourceUrl: "https://vsdc.vn/vi/ad/197086",
  rawEvidenceHash: "a".repeat(64),
  sourcePublishedAt: null,
  sourceUpdatedAt: "2026-06-19T09:42:40+07:00",
  normalizationVersion: "qeo123-v1",
}

test("QEO-123 runtime store persists one atomic notice and verifies exact canonical read-back", async () => {
  let rpcArgs: Record<string, unknown> | null = null
  const query = {
    select() { return this },
    eq() { return this },
    async maybeSingle() {
      return {
        data: {
          ticker: "VHM",
          isin: "VN000000VHM0",
          exchange: "HOSE",
          action_type: "cash_dividend",
          status: "active",
          record_date: "2026-06-30",
          ex_date: "2026-06-29",
          ex_date_basis: "derived",
          ex_date_derivation_method: "record_date_previous_verified_trading_session",
          trading_calendar_version: "vn-securities-calendar-2018-2026-v1",
          cash_per_share: 6000,
          stock_ratio_numerator: null,
          stock_ratio_denominator: null,
          rights_ratio_numerator: null,
          rights_ratio_denominator: null,
          subscription_price: null,
          source: "vsdc",
          source_event_id: "197086",
          lineage_root_source_event_id: "197086",
          source_component_key: "component:0",
          source_url: "https://vsdc.vn/vi/ad/197086",
          raw_evidence_hash: "a".repeat(64),
          source_published_at: null,
          source_updated_at: "2026-06-19T02:42:40+00:00",
          normalization_version: "qeo123-v1",
        },
        error: null,
      }
    },
  }
  const client = {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "persist_corporate_action_notice")
      rpcArgs = args
      return {
        data: { evidence_id: "11111111-1111-1111-1111-111111111111", action_count: 1, applied_count: 1, stale_count: 0 },
        error: null,
      }
    },
    from(table: string) {
      assert.equal(table, "corporate_actions")
      return query
    },
  }

  const result = await persistCorporateActionNotice(client as never, {
    source: "vsdc",
    sourceEventId: "197086",
    sourceUrl: "https://vsdc.vn/vi/ad/197086",
    ticker: "VHM",
    rawPayload: { fixture: "vhm-2026-cash" },
    rawEvidenceHash: "a".repeat(64),
    sourceUpdatedAt: "2026-06-19T09:42:40+07:00",
  }, [action])

  assert.equal(result.appliedCount, 1)
  assert.equal(result.staleCount, 0)
  assert.notEqual(rpcArgs, null)
  const persistedArgs = rpcArgs as unknown as Record<string, unknown>
  assert.deepEqual(persistedArgs.p_evidence, {
    source: "vsdc",
    source_event_id: "197086",
    source_url: "https://vsdc.vn/vi/ad/197086",
    ticker: "VHM",
    raw_payload: { fixture: "vhm-2026-cash" },
    raw_evidence_hash: "a".repeat(64),
    source_published_at: null,
    source_updated_at: "2026-06-19T09:42:40+07:00",
    amendment_type: null,
    referenced_notice_number: null,
    referenced_notice_date: null,
    referenced_source_event_id: null,
  })
})

test("QEO-123 read model exposes provider-agnostic values and preserves unknown ex-date", async () => {
  const rows = [{
    id: "22222222-2222-2222-2222-222222222222",
    ticker: "SNC",
    action_type: "cash_dividend",
    status: "active",
    ex_date: null,
    ex_date_basis: "unknown",
    record_date: "2026-08-27",
    payment_date: null,
    effective_date: null,
    cash_per_share: 1200,
    stock_ratio_numerator: null,
    stock_ratio_denominator: null,
    rights_ratio_numerator: null,
    rights_ratio_denominator: null,
    subscription_price: null,
    source: "vsdc",
    source_url: "https://vsdc.vn/vi/ad/199110",
    source_event_id: "199110",
    lineage_root_source_event_id: "198978",
    source_component_key: "component:0",
    source_updated_at: "2026-08-11T04:10:33+00:00",
    verified_at: "2026-09-06T12:00:00+00:00",
  }]
  const query = {
    select() { return this },
    eq() { return this },
    gte() { return this },
    lte() { return this },
    order: async () => ({ data: rows, error: null }),
  }
  const client = { from: () => query }
  const result = await readCorporateActions(client as never, { ticker: "snc" })

  assert.equal(result.length, 1)
  assert.equal(result[0]?.ticker, "SNC")
  assert.equal(result[0]?.exDate, null)
  assert.equal(result[0]?.verificationStatus, "ex_date_unknown")
  assert.equal(result[0]?.cashPerShare, 1200)
  assert.equal(result[0]?.sourceLabel, "VSDC")
})
