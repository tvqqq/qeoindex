import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { buildHistoricalSourceUrl } from "../modules/market/history/contract.ts"

const NOW = new Date("2026-09-05T12:30:00.000Z")
const historySource = readFileSync("modules/market/history/index.ts", "utf8")
const titanSource = readFileSync("modules/market/providers/titanlabs/daily.ts", "utf8")
const precedenceSource = readFileSync("supabase/migrations/20260905131000_qeo102_titanlabs_history_fallback_precedence.sql", "utf8")

test("QEO-102 exposes TitanLabs as credential-free Daily-only historical source", () => {
  const url = buildHistoricalSourceUrl("TitanLabs", "vic", "1D", 366, NOW)
  assert.equal(url, "https://www.titanlabs.vn/api/charts/series?symbol=VIC")
  assert.throws(() => buildHistoricalSourceUrl("TitanLabs", "VIC", "1H", 30, NOW), /does not support 1H/)
})

test("QEO-102 TitanLabs parser normalizes VND prices and validates parallel vectors", () => {
  assert.match(titanSource, /TITANLABS_SERIES_URL\s*=\s*"https:\/\/www\.titanlabs\.vn\/api\/charts\/series"/)
  assert.match(titanSource, /\[opens, highs, lows, closes, volumes\]\.some\(\(items\) => items\.length !== times\.length\)/)
  assert.match(titanSource, /Math\.trunc\(declaredCount\) !== times\.length/)
  assert.match(titanSource, /open:\s*rawOpen \/ 1000/)
  assert.match(titanSource, /high:\s*rawHigh \/ 1000/)
  assert.match(titanSource, /low:\s*rawLow \/ 1000/)
  assert.match(titanSource, /close:\s*rawClose \/ 1000/)
  assert.match(titanSource, /bar\.high >= Math\.max\(bar\.open, bar\.close, bar\.low\)/)
  assert.match(titanSource, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/)
})

test("QEO-102 Daily waterfall is fail-closed and keeps TitanLabs last", () => {
  assert.match(historySource, /strictDailyBars\("VCI"/)
  assert.match(historySource, /strictDailyBars\("DNSE"/)
  assert.match(historySource, /strictDailyBars\("Yahoo"/)
  assert.match(historySource, /strictDailyBars\("VNDirect"/)
  assert.match(historySource, /strictDailyBars\("TitanLabs"/)
  assert.match(historySource, /Yahoo:[\s\S]*VNDirect:[\s\S]*TitanLabs:/)
})

test("QEO-102 DB precedence permits valid repair of invalid legacy rows only", () => {
  assert.match(precedenceSource, /when old\.provider = 'TitanLabs' then 50/)
  assert.match(precedenceSource, /when new\.provider = 'TitanLabs' then 50/)
  assert.match(precedenceSource, /if old_valid and not new_valid then[\s\S]*return old;/)
  assert.match(precedenceSource, /if not old_valid and new_valid then[\s\S]*return new;/)
  assert.match(precedenceSource, /VCI > DNSE > verified final-close repair > Yahoo\/Fallback > VNDirect > TitanLabs/)
})
