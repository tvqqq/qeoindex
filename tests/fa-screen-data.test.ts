import assert from "node:assert/strict"
import test from "node:test"

import { FA_SCREEN_ROWS, FA_VALUATION_ORDER, type FaValuation } from "../modules/research/fa-screen-data.ts"

test("FA screen snapshot keeps the 99-stock ex-MSN contract", () => {
  assert.equal(FA_SCREEN_ROWS.length, 99)
  assert.equal(new Set(FA_SCREEN_ROWS.map((row) => row.ticker)).size, 99)
  assert.equal(new Set(FA_SCREEN_ROWS.map((row) => row.rank)).size, 99)
  assert.equal(FA_SCREEN_ROWS.some((row) => row.ticker === "MSN"), false)
  assert.equal(FA_SCREEN_ROWS.some((row) => row.rank === 23), false)
})

test("FA valuation bucket counts match the reviewed snapshot", () => {
  const counts = new Map<FaValuation, number>(FA_VALUATION_ORDER.map((valuation) => [valuation, 0]))
  for (const row of FA_SCREEN_ROWS) counts.set(row.valuation, (counts.get(row.valuation) ?? 0) + 1)

  assert.deepEqual(Object.fromEntries(counts), {
    "Rất hấp dẫn": 16,
    "Hấp dẫn": 28,
    "Hợp lý": 22,
    "Khá cao": 14,
    "Đắt–rủi ro": 19,
  })
  assert.equal((counts.get("Rất hấp dẫn") ?? 0) + (counts.get("Hấp dẫn") ?? 0), 44)
})

test("FA screen rows contain finite ratios and supported valuation labels", () => {
  const allowed = new Set(FA_VALUATION_ORDER)
  for (const row of FA_SCREEN_ROWS) {
    assert.ok(Number.isFinite(row.pe), `${row.ticker}: invalid P/E`)
    assert.ok(Number.isFinite(row.pb), `${row.ticker}: invalid P/B`)
    assert.ok(Number.isFinite(row.roe), `${row.ticker}: invalid ROE`)
    assert.ok(row.grade.length > 0, `${row.ticker}: missing FA grade`)
    assert.ok(allowed.has(row.valuation), `${row.ticker}: unsupported valuation`)
  }
})

test("low-confidence snapshot remains explicit", () => {
  assert.equal(FA_SCREEN_ROWS.filter((row) => row.confidence === "Low–Medium").length, 15)
})
