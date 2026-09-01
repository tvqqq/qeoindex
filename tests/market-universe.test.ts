import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import { selectMarketUniverse, type MarketUniverseSelectionRow } from "../lib/market-universe-selection.ts"

function row(ticker: string, marketCapBillion: number, averageVolume50d: number): MarketUniverseSelectionRow {
  return {
    ticker,
    companyName: `${ticker} Company`,
    exchange: ticker.endsWith("H") ? "HNX" : "HOSE",
    sector: "Test",
    marketCapBillion,
    averageVolume50d,
    sourceAsOfDate: "2026-09-01",
  }
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("selector uses strict > boundaries and requires both conditions", () => {
  const selected = selectMarketUniverse([
    row("VOL_EQ", 100, 250_000),
    row("CAP_EQ", 10, 1_000_000),
    row("VOL_LOW", 100, 249_999),
    row("CAP_LOW", 9.99, 1_000_000),
    row("PASS", 10.01, 250_001),
  ], { minMarketCapBillion: 10, minAverageVolume50d: 250_000, maxSize: 200 })

  assert.deepEqual(selected.map((item) => item.ticker), ["PASS"])
  assert.equal(selected[0]?.rank, 1)
})

test("selector ranks market cap desc then Avg50 desc then ticker asc", () => {
  const selected = selectMarketUniverse([
    row("ZZZ", 100, 500_000),
    row("BBB", 200, 400_000),
    row("AAA", 200, 400_000),
    row("CCC", 200, 600_000),
  ], { minMarketCapBillion: 10, minAverageVolume50d: 250_000, maxSize: 200 })

  assert.deepEqual(selected.map((item) => [item.ticker, item.rank]), [
    ["CCC", 1],
    ["AAA", 2],
    ["BBB", 3],
    ["ZZZ", 4],
  ])
})

test("selector caps at 200 and never pads failing rows", () => {
  const candidates = Array.from({ length: 207 }, (_, index) => row(`T${String(index + 1).padStart(3, "0")}`, 10_000 - index, 300_000 + index))
  candidates.push(row("FAIL", 1_000_000, 1))
  const selected = selectMarketUniverse(candidates, { minMarketCapBillion: 10, minAverageVolume50d: 250_000, maxSize: 200 })
  assert.equal(selected.length, 200)
  assert.equal(selected.at(-1)?.rank, 200)
  assert.equal(selected.some((item) => item.ticker === "FAIL"), false)

  const sparse = selectMarketUniverse([row("ONLY", 11, 250_001), row("NO", 9, 2_000_000)], { minMarketCapBillion: 10, minAverageVolume50d: 250_000, maxSize: 200 })
  assert.equal(sparse.length, 1)
})

test("selector preserves non-HOSE exchange and does not mutate source rows", () => {
  const hnx = row("ABCH", 100, 500_000)
  const selected = selectMarketUniverse([hnx], { minMarketCapBillion: 10, minAverageVolume50d: 250_000, maxSize: 200 })
  assert.equal(selected[0]?.exchange, "HNX")
  assert.equal((hnx as MarketUniverseSelectionRow & { rank?: number }).rank, undefined)
})

test("canonical universe persistence and runtime boundaries exist", () => {
  const migration = "supabase/migrations/20260901090000_market_universe_top_stocks.sql"
  const service = "lib/market-universe.ts"
  assert.equal(existsSync(new URL(`../${migration}`, import.meta.url)), true)
  assert.equal(existsSync(new URL(`../${service}`, import.meta.url)), true)
  if (!existsSync(new URL(`../${migration}`, import.meta.url)) || !existsSync(new URL(`../${service}`, import.meta.url))) return

  const sql = source(migration)
  const runtime = source(service)
  assert.match(sql, /create table[^;]*market_universe_runs/is)
  assert.match(sql, /create table[^;]*market_universe_memberships/is)
  assert.match(sql, /rank[^\n]*between 1 and 200/i)
  assert.match(sql, /qeo_current_market_universe/i)
  assert.match(sql, /qeo_publish_market_universe_run/i)
  assert.match(runtime, /market-universe:v1/)
  assert.match(runtime, /readThroughUiCache/)
})

test("monthly sync contract guarantees Storage object before publication", () => {
  const edge = "supabase/functions/market-universe-sync/index.ts"
  assert.equal(existsSync(new URL(`../${edge}`, import.meta.url)), true)
  if (!existsSync(new URL(`../${edge}`, import.meta.url))) return
  const code = source(edge)
  assert.match(code, /stock-logo/)
  assert.match(code, /250_000|250000/)
  assert.match(code, /market_cap_billion/)
  assert.match(code, /average_volume_50_sessions/)
  assert.match(code, /generated_fallback/)
  assert.match(code, /qeo_publish_market_universe_run/)
})

test("Top100 static aliases are no longer the canonical runtime universe", () => {
  const universe = source("lib/wyckoff-universe.ts")
  assert.doesNotMatch(universe, /CANONICAL_TOP100_TICKERS/)
  assert.match(universe, /UNIVERSE_SIZE\s*=\s*200/)
})
