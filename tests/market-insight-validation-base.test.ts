import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

import {
  parseVerifiedMarketClosePayloads,
  validateMarketCloseSnapshot,
  parseNumeric,
  clampPercent,
  mapRotationState,
  normalizeSectorSlug,
  normalizeSectorMaSlug,
  type NormalizedIndexRow,
} from "../supabase/functions/_shared/market-close-normalizer.ts"

function makeSectorIbd(names: string[]) {
  return {
    ten_nganh: names,
    closeprice: names.map((_, index) => 100 + index),
    rss: names.map((_, index) => 60 + index),
    totalval_market_pulse: names.map((_, index) => 3500 - index * 700),
    totalvalbefore_market_pulse: names.map((_, index) => 3200 - index * 650),
    percent_market_pulse: names.map((_, index) => 9.38 - index * 3),
    percent_market_pulse_marketcap: names.map((_, index) => 1.25 - index * 2.05),
  }
}

function makeSectorCoverageInput(sectorIbdPayload: Record<string, unknown>): any {
  const asOf = "2026-08-31T08:00:00.000Z"
  const indexes = ["VNINDEX", "VN30", "HNX", "UPCOM"].map((index_code) => ({ index_code, value: 1000, change: 1, change_pct: 0.1, reference: 999, open: 1000, high: 1001, low: 999, matched_volume: 100, traded_value: 100, previous_value_change_pct: 0, advances: 1, unchanged: 1, declines: 1, ceilings: 0, floors: 0, market_pe: null, foreign_buy_value: null, foreign_sell_value: null, foreign_net_value: null, quality_status: "healthy", missing_fields: [], evidence_refs: [], source_timestamp: asOf, as_of: asOf }))
  const names = Array.isArray(sectorIbdPayload.ten_nganh) ? sectorIbdPayload.ten_nganh.map(String) : []
  return {
    sessionDate: "2026-08-31", asOfIso: asOf,
    pulseContentPayload: { content: JSON.stringify({ list_main_content: [{ title: "Ngày phân phối", distribution_date: 1 }] }) }, pulseOk: true,
    maBreadthPayload: { name: ["MA10", "MA20", "MA50", "MA200"], above: [50, 50, 50, 50], under: [50, 50, 50, 50] }, maBreadthOk: true,
    riskPayload: [{ risk: 0.3, tradingdate: "2026-08-31" }], riskOk: true, psychologyPayload: [{ value: 55, tradingdate: "2026-08-31" }], psychologyOk: true,
    valuationPayload: [{ tradingdate: "2026-08-31", price: 1000, pe: 12, pb: 1.5 }], valuationOk: true,
    sectorIbdPayload, sectorIbdOk: true,
    sectorRrgPayload: Object.fromEntries(names.map((name) => [name, [{ tradingdate: "2026-08-31", status: "leading", closeprice: 100 }]])), sectorRrgOk: true,
    sectorMaPayload: Object.fromEntries(names.map((name) => [name, { ma10: "up", ma20: "up", ma50: "up" }])), sectorMaOk: true,
    sectorBreadthPayload: names.map((nganh) => ({ nganh, count_advances: 1, count_declines: 1, count_nochange: 1 })), sectorBreadthOk: true,
    cashFlowsPayload: { nuocngoairong: [1], tudoanh: [1], cntckhacrong: [0] }, cashFlowsOk: true,
    topVolatilityTickers: ["AAA"], getLivePayload: { stockcode: ["AAA"], lastprice: [10], totalvol: [100], perchange: [1] }, getLiveOk: true,
    providerIndexes: indexes,
  }
}

test("market-close normalizer: parseNumeric helper correctly handles numbers, strings, commas, percentages, and empty values", () => {
  assert.equal(parseNumeric(123.45), 123.45)
  assert.equal(parseNumeric("1,234.56"), 1234.56)
  assert.equal(parseNumeric("+15.2%"), 15.2)
  assert.equal(parseNumeric("-3.45"), -3.45)
  assert.equal(parseNumeric("--"), null)
  assert.equal(parseNumeric("-"), null)
  assert.equal(parseNumeric("N/A"), null)
  assert.equal(parseNumeric(null), null)
  assert.equal(parseNumeric(undefined), null)
  assert.equal(parseNumeric("invalid"), null)
})

test("market-close normalizer: clampPercent bounds values strictly between 0 and 100", () => {
  assert.equal(clampPercent(45.678), 45.68)
  assert.equal(clampPercent(-10), 0)
  assert.equal(clampPercent(150), 100)
  assert.equal(clampPercent(null), null)
})

test("market-close normalizer: mapRotationState normalizes known and unknown states", () => {
  assert.equal(mapRotationState("leading"), "leading")
  assert.equal(mapRotationState("Dẫn dắt"), "leading")
  assert.equal(mapRotationState("improving"), "recovering")
  assert.equal(mapRotationState("Phục hồi"), "recovering")
  assert.equal(mapRotationState("weakening"), "weakening")
  assert.equal(mapRotationState("Suy yếu"), "weakening")
  assert.equal(mapRotationState("lagging"), "lagging")
  assert.equal(mapRotationState("Tụt hậu"), "lagging")
  assert.equal(mapRotationState("unknown_state"), "unknown")
  assert.equal(mapRotationState(null), "unknown")
})

test("market-close normalizer: normalizeSectorSlug converts Vietnamese names to URL/DB-safe slugs", () => {
  assert.equal(normalizeSectorSlug("Bất động sản"), "bat_dong_san")
  assert.equal(normalizeSectorSlug("Tài chính & Ngân hàng"), "tai_chinh_ngan_hang")
  assert.equal(normalizeSectorSlug("Thực phẩm - Đồ uống"), "thuc_pham_do_uong")
  assert.equal(normalizeSectorSlug("Dầu khí"), "dau_khi")
})

test("market-close normalizer: normalizeSectorMaSlug matches KFSP getdatama page contract", () => {
  assert.equal(normalizeSectorMaSlug("NÔNG - LÂM - NGƯ"), "nong_lam_ngu")
  assert.equal(normalizeSectorMaSlug("Thiết bị - Y tế"), "thiet_bi_-_y_te")
  assert.equal(normalizeSectorMaSlug("Bất động sản"), "bat_dong_san")
})

test("market-close normalizer: parses verified bundle contract fixture with canonical indexes and compound keys", () => {
  const fixturePath = path.resolve("tests/fixtures/market-close-sanitized-contract.json")
  assert.ok(fs.existsSync(fixturePath), "Sanitized contract fixture must exist")

  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"))

  // Canonical index rows
  const canonicalIndexes: NormalizedIndexRow[] = [
    {
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
    },
    {
      session_date: "2026-08-26",
      index_code: "VN30",
      value: 1320.10,
      change: 14.50,
      change_pct: 1.11,
      reference: 1305.60,
      open: 1308.00,
      high: 1322.00,
      low: 1307.50,
      matched_volume: 245000000,
      traded_value: 9450.2,
      previous_value_change_pct: 15.1,
      advances: 22,
      unchanged: 4,
      declines: 4,
      ceilings: 2,
      floors: 0,
      market_pe: 13.80,
      foreign_buy_value: 850.0,
      foreign_sell_value: 790.0,
      foreign_net_value: 60.0,
      quality_status: "healthy",
      missing_fields: [],
      evidence_refs: [{ field: "value", source_class: "canonical_market_feed", observed_at: "2026-08-26T08:15:00.000Z" }],
      source_timestamp: "2026-08-26T08:15:00.000Z",
      as_of: "2026-08-26T08:15:00.000Z",
    },
    {
      session_date: "2026-08-26",
      index_code: "HNX",
      value: 242.30,
      change: -0.45,
      change_pct: -0.19,
      reference: 242.75,
      open: 243.00,
      high: 244.10,
      low: 241.80,
      matched_volume: 68000000,
      traded_value: 1250.0,
      previous_value_change_pct: -5.4,
      advances: 85,
      unchanged: 55,
      declines: 98,
      ceilings: 3,
      floors: 2,
      market_pe: 15.10,
      foreign_buy_value: 45.0,
      foreign_sell_value: 52.0,
      foreign_net_value: -7.0,
      quality_status: "healthy",
      missing_fields: [],
      evidence_refs: [{ field: "value", source_class: "canonical_market_feed", observed_at: "2026-08-26T08:15:00.000Z" }],
      source_timestamp: "2026-08-26T08:15:00.000Z",
      as_of: "2026-08-26T08:15:00.000Z",
    },
    {
      session_date: "2026-08-26",
      index_code: "UPCOM",
      value: 94.80,
      change: 0.12,
      change_pct: 0.13,
      reference: 94.68,
      open: 94.70,
      high: 95.10,
      low: 94.50,
      matched_volume: 34000000,
      traded_value: 480.0,
      previous_value_change_pct: 2.1,
      advances: 145,
      unchanged: 110,
      declines: 120,
      ceilings: 8,
      floors: 4,
      market_pe: null,
      foreign_buy_value: 12.0,
      foreign_sell_value: 10.0,
      foreign_net_value: 2.0,
      quality_status: "healthy",
      missing_fields: [],
      evidence_refs: [{ field: "value", source_class: "canonical_market_feed", observed_at: "2026-08-26T08:15:00.000Z" }],
      source_timestamp: "2026-08-26T08:15:00.000Z",
      as_of: "2026-08-26T08:15:00.000Z",
    },
  ]

  const asOf = "2026-08-26T08:15:00.000Z"
  const snapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: asOf,
    pulseContentPayload: raw.market_pulse_get_content,
    pulseOk: true,
    maBreadthPayload: raw.socket_ma_breadth,
    maBreadthOk: true,
    riskPayload: raw.socket_risk_index,
    riskOk: true,
    psychologyPayload: raw.socket_psychology,
    psychologyOk: true,
    valuationPayload: [{ tradingdate: "2026-08-26", price: 1284.55, pe: 14.35, pb: 1.82, pe_1std_up: 15.5, pe_1std_down: 12.5, pe_2std_up: 17, pe_2std_down: 11, pb_1std_up: 2, pb_1std_down: 1.5, pb_2std_up: 2.2, pb_2std_down: 1.3 }],
    valuationOk: true,
    sectorIbdPayload: {
      ten_nganh: raw.socket_sector_pulse.name,
      closeprice: [112.5, 108.2, 119.4],
      rss: [72, 65, 81],
      totalval_market_pulse: raw.socket_sector_pulse.totalval,
      totalvalbefore_market_pulse: raw.socket_sector_pulse.totalvalbefore,
      percent_market_pulse: [18.95, 4.49, 23.1],
      percent_market_pulse_marketcap: raw.socket_sector_pulse.percent,
    },
    sectorIbdOk: true,
    sectorRrgPayload: {
      "Bất động sản": [{ tradingdate: "2026-08-26", status: "Dẫn dắt", closeprice: 112.5 }],
      "Ngân hàng": [{ tradingdate: "2026-08-26", status: "Phục hồi", closeprice: 108.2 }],
      "Dịch vụ tài chính": [{ tradingdate: "2026-08-26", status: "Dẫn dắt", closeprice: 119.4 }],
    },
    sectorRrgOk: true,
    sectorMaPayload: {
      "Bất động sản": { ma10: "up", ma20: "up", ma50: "up" },
      "Ngân hàng": { ma10: "up", ma20: "up", ma50: "down" },
      "Dịch vụ tài chính": { ma10: "up", ma20: "up", ma50: "up" },
    },
    sectorMaOk: true,
    sectorBreadthPayload: raw.socket_sector_breadth,
    sectorBreadthOk: true,
    cashFlowsPayload: raw.rest_cash_flows,
    cashFlowsOk: true,
    topVolatilityTickers: raw.rest_top_volatility_tickers,
    getLivePayload: raw.socket_getlive,
    getLiveOk: true,
    providerIndexes: canonicalIndexes,
  })

  assert.equal(snapshot.session_date, "2026-08-26")
  assert.equal(snapshot.quality_status, "healthy")
  assert.equal(snapshot.daily.market_regime, null)
  assert.equal(snapshot.daily.sentiment_score, 56)
  assert.equal(snapshot.daily.sentiment_label, "Trung lập")
  assert.equal(snapshot.daily.risk_score, 0.63)
  assert.equal(snapshot.daily.risk_label, "Trung tính")
  assert.equal(snapshot.daily.distribution_count, 2)
  assert.equal(snapshot.daily.above_ma10_pct, 70.89)
  assert.equal(snapshot.daily.above_ma20_pct, 67.59)
  assert.equal(snapshot.daily.foreign_net_value, -145.2)
  assert.equal(snapshot.daily.proprietary_net_value, 92.5)
  assert.equal(snapshot.daily.source_timestamp, asOf)
  assert.equal(snapshot.staged_counts.sector_returned_count, 3)
  assert.equal(snapshot.staged_counts.sector_valid_count, 3)
  assert.equal(snapshot.staged_counts.sector_missing_required_count, 0)
  assert.equal(snapshot.staged_counts.sector_recognized_rotation_count, 3)

  // 4 Indexes parsed
  assert.equal(snapshot.indexes.length, 4)

  // Sectors parsed with compound key and breadth
  assert.ok(snapshot.sectors.length > 0)
  const bank = snapshot.sectors.find((s) => s.sector_key === "ngan_hang")
  assert.ok(bank)
  assert.equal(bank.average_change_pct, 0.75)
  assert.equal(bank.traded_value, 5120.0)
  assert.equal(bank.advances, 18)
  assert.equal(bank.declines, 4)
  assert.equal(bank.unchanged, 6)
  assert.equal(bank.source_timestamp, asOf)

  // Leaders parsed from live volatility
  assert.ok(snapshot.leaders.length > 0)
  const ssi = snapshot.leaders.find((l) => l.ticker === "SSI")
  assert.ok(ssi)
  assert.equal(ssi.price, 36.8)
  assert.equal(ssi.change_pct, 3.37)
  assert.equal(ssi.metric_label, "36.5M CP")
  assert.equal(ssi.source_timestamp, asOf)

  // Check unique compound staging keys
  const keys = snapshot.staged_items.map((item) => item.staging_key)
  const uniqueKeys = new Set(keys)
  assert.equal(keys.length, uniqueKeys.size, "Compound staging keys must be unique")

  // Validation must pass
  const validation = validateMarketCloseSnapshot(snapshot)
  assert.ok(validation.valid, `Expected valid snapshot, got errors: ${validation.errors.join(", ")}`)
})

test("market-close normalizer preserves mixed, empty and all-valid sector evidence counts", () => {
  const allValid = parseVerifiedMarketClosePayloads(makeSectorCoverageInput(makeSectorIbd(["Ngân hàng", "Bất động sản"])))
  assert.deepEqual(allValid.staged_counts.sector_returned_count, 2)
  assert.deepEqual(allValid.staged_counts.sector_valid_count, 2)
  assert.deepEqual(allValid.staged_counts.sector_missing_required_count, 0)
  assert.equal(allValid.endpoint_coverage.sector_ibd, true)

  const mixedPayload = makeSectorIbd(["Ngân hàng", ""])
  ;(mixedPayload.percent_market_pulse_marketcap as unknown[])[1] = "--"
  const mixed = parseVerifiedMarketClosePayloads(makeSectorCoverageInput(mixedPayload))
  assert.equal(mixed.staged_counts.sector_returned_count, 2)
  assert.equal(mixed.staged_counts.sector_valid_count, 1)
  assert.equal(mixed.staged_counts.sector_missing_required_count, 1)
  assert.equal(mixed.endpoint_coverage.sector_ibd, false)

  const empty = parseVerifiedMarketClosePayloads(makeSectorCoverageInput(makeSectorIbd([])))
  assert.equal(empty.staged_counts.sector_returned_count, 0)
  assert.equal(empty.staged_counts.sector_valid_count, 0)
  assert.equal(empty.staged_counts.sector_missing_required_count, 0)
  assert.equal(empty.endpoint_coverage.sector_ibd, false)
})

test("market-close normalizer: rejects missing or null canonical index data without inventing fake fallbacks", () => {
  const corruptedIndexes: NormalizedIndexRow[] = [
    {
      session_date: "2026-08-26",
      index_code: "VNINDEX",
      value: null,
      change: null,
      change_pct: null,
      reference: null,
      open: null,
      high: null,
      low: null,
      matched_volume: null,
      traded_value: null,
      previous_value_change_pct: null,
      advances: 0,
      unchanged: 0,
      declines: 0,
      ceilings: 0,
      floors: 0,
      market_pe: null,
      foreign_buy_value: null,
      foreign_sell_value: null,
      foreign_net_value: null,
      quality_status: "degraded",
      missing_fields: ["value"],
      evidence_refs: [],
      source_timestamp: null,
      as_of: "2026-08-26T08:15:00.000Z",
    },
  ]

  const snapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: "2026-08-26T08:15:00.000Z",
    providerIndexes: corruptedIndexes,
  })

  const vnindex = snapshot.indexes.find((i) => i.index_code === "VNINDEX")
  assert.strictEqual(vnindex?.value, null)
  assert.strictEqual(snapshot.quality_status, "failing")

  const validation = validateMarketCloseSnapshot(snapshot)
  assert.strictEqual(validation.valid, false)
  assert.ok(validation.errors.some((err) => err.includes("VNINDEX") || err.includes("HNX")))
})

test("market-close normalizer: fail-closed on partial P0 socket/flow/sector coverage", () => {
  const canonicalIndexes: NormalizedIndexRow[] = [
    { session_date: "2026-08-26", index_code: "VNINDEX", value: 1284.55, change: 11.25, change_pct: 0.88, reference: 1273.3, open: 1276.1, high: 1286.2, low: 1275.4, matched_volume: 780450000, traded_value: 19850.4, previous_value_change_pct: null, advances: 274, unchanged: 68, declines: 122, ceilings: 9, floors: 1, market_pe: 14.35, foreign_buy_value: null, foreign_sell_value: null, foreign_net_value: null, quality_status: "healthy", missing_fields: [], evidence_refs: [], source_timestamp: null, as_of: "2026-08-26T08:15:00.000Z" },
    { session_date: "2026-08-26", index_code: "VN30", value: 1320.10, change: 14.50, change_pct: 1.11, reference: 1305.6, open: 1308.0, high: 1322.0, low: 1307.5, matched_volume: 245000000, traded_value: 9450.2, previous_value_change_pct: null, advances: 22, unchanged: 4, declines: 4, ceilings: 2, floors: 0, market_pe: 13.80, foreign_buy_value: null, foreign_sell_value: null, foreign_net_value: null, quality_status: "healthy", missing_fields: [], evidence_refs: [], source_timestamp: null, as_of: "2026-08-26T08:15:00.000Z" },
    { session_date: "2026-08-26", index_code: "HNX", value: 242.30, change: -0.45, change_pct: -0.19, reference: 242.75, open: 243.0, high: 244.1, low: 241.8, matched_volume: 68000000, traded_value: 1250.0, previous_value_change_pct: null, advances: 85, unchanged: 55, declines: 98, ceilings: 3, floors: 2, market_pe: 15.10, foreign_buy_value: null, foreign_sell_value: null, foreign_net_value: null, quality_status: "healthy", missing_fields: [], evidence_refs: [], source_timestamp: null, as_of: "2026-08-26T08:15:00.000Z" },
    { session_date: "2026-08-26", index_code: "UPCOM", value: 94.80, change: 0.12, change_pct: 0.13, reference: 94.68, open: 94.7, high: 95.1, low: 94.5, matched_volume: 34000000, traded_value: 480.0, previous_value_change_pct: null, advances: 145, unchanged: 110, declines: 120, ceilings: 8, floors: 4, market_pe: null, foreign_buy_value: null, foreign_sell_value: null, foreign_net_value: null, quality_status: "healthy", missing_fields: [], evidence_refs: [], source_timestamp: null, as_of: "2026-08-26T08:15:00.000Z" },
  ]

  // Condition 1: Missing MA50 and MA200
  const partialMaSnapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: "2026-08-26T08:15:00.000Z",
    providerIndexes: canonicalIndexes,
    pulseOk: true,
    pulseContentPayload: { content: JSON.stringify({ list_main_content: [{ title: "Ngày phân phối", distribution_date: 2 }] }) },
    maBreadthOk: true,
    maBreadthPayload: { name: ["MA10", "MA20"], above: [100, 80], under: [50, 40] },
    riskOk: true,
    riskPayload: [{ risk: 0.63 }],
    psychologyOk: true,
    psychologyPayload: [{ value: 56 }],
    cashFlowsOk: true,
    cashFlowsPayload: { nuocngoairong: [-145.2], tudoanh: [92.5], cntckhacrong: [52.7] },
    sectorIbdOk: true,
    sectorIbdPayload: makeSectorIbd(["Ngân hàng"]),
    sectorBreadthOk: true,
    sectorBreadthPayload: [{ nganh: "Ngân hàng", count_advances: 18, count_declines: 4, count_nochange: 2 }],
  })
  assert.equal(partialMaSnapshot.endpoint_coverage.ma_breadth, false)
  assert.equal(partialMaSnapshot.quality_status, "failing")

  // Condition 2: Missing distribution count in pulse
  const noDistSnapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: "2026-08-26T08:15:00.000Z",
    providerIndexes: canonicalIndexes,
    pulseOk: true,
    pulseContentPayload: { content: JSON.stringify({ list_main_content: [{ title: "Tổng quan thị trường chung" }] }) }, // No distribution date
    maBreadthOk: true,
    maBreadthPayload: { name: ["MA10", "MA20", "MA50", "MA200"], above: [100, 80, 60, 50], under: [50, 40, 50, 50] },
    riskOk: true,
    riskPayload: [{ risk: 0.63 }],
    psychologyOk: true,
    psychologyPayload: [{ value: 56 }],
    cashFlowsOk: true,
    cashFlowsPayload: { nuocngoairong: [-145.2], tudoanh: [92.5] },
    sectorIbdOk: true,
    sectorIbdPayload: makeSectorIbd(["Ngân hàng"]),
    sectorBreadthOk: true,
    sectorBreadthPayload: [{ nganh: "Ngân hàng", count_advances: 18, count_declines: 4, count_nochange: 2 }],
  })
  assert.equal(noDistSnapshot.endpoint_coverage.market_pulse_content, false)
  assert.equal(noDistSnapshot.quality_status, "failing")

  // Condition 3: Missing proprietary flow in cash flows
  const noPropFlowSnapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: "2026-08-26T08:15:00.000Z",
    providerIndexes: canonicalIndexes,
    pulseOk: true,
    pulseContentPayload: { content: JSON.stringify({ list_main_content: [{ title: "Ngày phân phối", distribution_date: 2 }] }) },
    maBreadthOk: true,
    maBreadthPayload: { name: ["MA10", "MA20", "MA50", "MA200"], above: [100, 80, 60, 50], under: [50, 40, 50, 50] },
    riskOk: true,
    riskPayload: [{ risk: 0.63 }],
    psychologyOk: true,
    psychologyPayload: [{ value: 56 }],
    cashFlowsOk: true,
    cashFlowsPayload: { nuocngoairong: [-145.2] }, // Missing tudoanh
    sectorIbdOk: true,
    sectorIbdPayload: makeSectorIbd(["Ngân hàng"]),
    sectorBreadthOk: true,
    sectorBreadthPayload: [{ nganh: "Ngân hàng", count_advances: 18, count_declines: 4, count_nochange: 2 }],
  })
  assert.equal(noPropFlowSnapshot.endpoint_coverage.cash_flows, false)
  assert.equal(noPropFlowSnapshot.quality_status, "failing")

  // Condition 4: Sector breadth partial match (2 sectors in pulse, but breadth only matches 1)
  const partialSectorBreadthSnapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: "2026-08-26T08:15:00.000Z",
    providerIndexes: canonicalIndexes,
    pulseOk: true,
    pulseContentPayload: { content: JSON.stringify({ list_main_content: [{ title: "Ngày phân phối", distribution_date: 2 }] }) },
    maBreadthOk: true,
    maBreadthPayload: { name: ["MA10", "MA20", "MA50", "MA200"], above: [100, 80, 60, 50], under: [50, 40, 50, 50] },
    riskOk: true,
    riskPayload: [{ risk: 0.63 }],
    psychologyOk: true,
    psychologyPayload: [{ value: 56 }],
    cashFlowsOk: true,
    cashFlowsPayload: { nuocngoairong: [-145.2], tudoanh: [92.5] },
    sectorIbdOk: true,
    sectorIbdPayload: makeSectorIbd(["Ngân hàng", "Bất động sản"]),
    sectorBreadthOk: true,
    sectorBreadthPayload: [{ nganh: "Ngân hàng", count_advances: 18, count_declines: 4, count_nochange: 2 }], // Missing Bất động sản
  })
  assert.equal(partialSectorBreadthSnapshot.endpoint_coverage.sector_breadth, false)
  assert.equal(partialSectorBreadthSnapshot.quality_status, "failing")

  // Condition 5: Leader with null price/vol is excluded from leaders
  const emptyLeaderSnapshot = parseVerifiedMarketClosePayloads({
    sessionDate: "2026-08-26",
    asOfIso: "2026-08-26T08:15:00.000Z",
    providerIndexes: canonicalIndexes,
    topVolatilityTickers: ["UNKNOWN_TICKER"],
    getLiveOk: true,
    getLivePayload: { stockcode: ["OTHER_TICKER"], lastprice: [null], totalvol: [null] },
  })
  assert.equal(emptyLeaderSnapshot.leaders.length, 0)
  assert.equal(emptyLeaderSnapshot.endpoint_coverage.get_live, false)
})
