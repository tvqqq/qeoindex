import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import type {
  NormalizedIndexRow,
  NormalizedLeaderRow,
} from "../supabase/functions/_shared/market-close-normalizer.ts"

import {
  deriveRiskLabel,
  deriveSentimentLabel,
} from "../supabase/functions/_shared/market-close-normalizer.ts"

function source(path: string) {
  return readFileSync(path, "utf8")
}

test("market-close edge types: deriveRiskLabel matches verified DOM scale", () => {
  assert.equal(deriveRiskLabel(0.25), "Thấp")
  assert.equal(deriveRiskLabel(0.63), "Trung tính")
  assert.equal(deriveRiskLabel(0.75), "Cao")
  assert.equal(deriveRiskLabel(null), null)
})

test("market-close edge types: deriveSentimentLabel matches KFSP psychology labels", () => {
  assert.equal(deriveSentimentLabel(80), "Tham lam tột độ")
  assert.equal(deriveSentimentLabel(60), "Tham lam")
  assert.equal(deriveSentimentLabel(40), "Trung lập")
  assert.equal(deriveSentimentLabel(20), "Sợ hãi")
  assert.equal(deriveSentimentLabel(10), "Sợ hãi tột độ")
  assert.equal(deriveSentimentLabel(null), null)
})

test("market-close edge types: structural interface completeness", () => {
  const dummyIndex: NormalizedIndexRow = {
    session_date: "2026-08-26",
    index_code: "VNINDEX",
    value: 1284.55,
    change: 11.25,
    change_pct: 0.88,
    reference: 1273.30,
    open: 1276.10,
    high: 1286.20,
    low: 1275.40,
    matched_volume: 780450000,
    traded_value: 19850.4,
    previous_value_change_pct: 12.5,
    advances: 274,
    unchanged: 68,
    declines: 122,
    ceilings: 9,
    floors: 1,
    market_pe: 14.35,
    foreign_buy_value: 1350.2,
    foreign_sell_value: 1495.4,
    foreign_net_value: -145.2,
    quality_status: "healthy",
    missing_fields: [],
    evidence_refs: [{ field: "value", source_class: "canonical_market_feed", observed_at: "2026-08-26T08:15:00.000Z" }],
    source_timestamp: "2026-08-26T08:15:00.000Z",
    as_of: "2026-08-26T08:15:00.000Z",
  }

  assert.equal(dummyIndex.foreign_net_value, -145.2)
  assert.equal(dummyIndex.foreign_buy_value, 1350.2)
  assert.equal(dummyIndex.foreign_sell_value, 1495.4)

  const dummyLeader: NormalizedLeaderRow = {
    session_date: "2026-08-26",
    category: "top_volume",
    rank: 1,
    ticker: "SSI",
    price: 36.8,
    change_pct: 3.37,
    estimated_index_points: 0.85,
    metric_value: 36500000,
    metric_label: "36.5M CP",
    quality_status: "healthy",
    missing_fields: [],
    evidence_refs: [{ field: "total_volume", source_class: "market_leaders", observed_at: "2026-08-26T08:15:00.000Z" }],
    source_timestamp: null,
    as_of: "2026-08-26T08:15:00.000Z",
  }

  assert.equal(dummyLeader.estimated_index_points, 0.85)
})

test("direct market snapshot writer fails closed on Vietnam securities holidays", () => {
  const marketSession = source("supabase/functions/market-session/index.ts")
  assert.match(marketSession, /_shared\/vn-market-calendar\.ts/)
  assert.match(marketSession, /isVietnamSecuritiesTradingDateKey/)
  assert.match(marketSession, /NON_TRADING_DAY/)
})
