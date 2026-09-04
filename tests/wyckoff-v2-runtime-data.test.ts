import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  DAILY_V2_CACHE_LIMIT,
  V2_CACHE_BATCH_SIZE,
  cachedHistoryFromRows,
  loadWyckoffV2CachedHistories,
} from "../modules/wyckoff/eod-cache-read.ts"

function cachedRow(ticker: string, index: number) {
  const barTime = new Date(Date.parse("2026-08-20T00:00:00.000Z") + index * 24 * 60 * 60 * 1000).toISOString()
  return {
    ticker,
    timeframe: "1D" as const,
    bar_time: barTime,
    open: 60 + index,
    high: 61 + index,
    low: 59 + index,
    close: 60.5 + index,
    volume: 1_000_000 + index,
    provider: "DNSE",
    provider_detail: "batch",
    source_url: "https://example.com/history",
    fetched_at: new Date(Date.parse(barTime) + 60_000).toISOString(),
  }
}

function compactRow(ticker: string, index: number) {
  const row = cachedRow(ticker, index)
  return [
    row.bar_time,
    row.open,
    row.high,
    row.low,
    row.close,
    row.volume,
    row.provider,
    row.provider_detail,
    row.source_url,
    row.fetched_at,
  ]
}

test("v2 universe source is canonical-market-only and has no legacy Notion parser compatibility", async () => {
  const body = await readFile(new URL("../modules/wyckoff/eod-universe-source.ts", import.meta.url), "utf8")
  assert.match(body, /getCanonicalUniverse/)
  assert.doesNotMatch(body, /NotionPage|NOTION_WYCKOFF_UNIVERSE_DATA_SOURCE_ID|parseWyckoffV2UniversePage|notion\/properties/)
})

test("bounded Daily cache budget is sufficient to derive at least 60 completed Weekly bars", () => {
  assert.ok(DAILY_V2_CACHE_LIMIT >= 1500)
  assert.ok(DAILY_V2_CACHE_LIMIT < 2200)
})

test("cached Daily history conversion sorts ascending and uses latest-row provenance", () => {
  const history = cachedHistoryFromRows("MSN", [
    { ticker: "MSN", timeframe: "1D", bar_time: "2026-08-25T07:00:00.000Z", open: 70, high: 72, low: 69, close: 71, volume: 2_000_000, provider: "DNSE", provider_detail: "new", source_url: "https://example.com/new", fetched_at: "2026-08-25T08:00:00.000Z" },
    { ticker: "MSN", timeframe: "1D", bar_time: "2026-08-24T07:00:00.000Z", open: 68, high: 71, low: 67, close: 70, volume: 1_000_000, provider: "Fallback", provider_detail: "old", source_url: "https://example.com/old", fetched_at: "2026-08-24T08:00:00.000Z" },
  ])
  assert.deepEqual(history.bars.map((bar) => bar.close), [70, 71])
  assert.equal(history.provider, "DNSE")
  assert.equal(history.detail, "new")
  assert.equal(history.sourceUrl, "https://example.com/new")
  assert.equal(history.firstBarAt, "2026-08-24T07:00:00.000Z")
  assert.equal(history.lastBarAt, "2026-08-25T07:00:00.000Z")
})

test("cached Daily history conversion rejects empty or invalid data", () => {
  assert.throws(() => cachedHistoryFromRows("MSN", []), /no usable/i)
  assert.throws(() => cachedHistoryFromRows("MSN", [
    { ticker: "MSN", timeframe: "1D", bar_time: "bad", open: 70, high: 72, low: 69, close: 71, volume: 1, provider: "DNSE", provider_detail: "x", source_url: "https://example.com", fetched_at: "2026-08-25T08:00:00.000Z" },
  ]), /no usable/i)
})

test("cached history loader uses compact grouped rows and bounds long-history batches to five tickers", async () => {
  const tickers = Array.from({ length: 25 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`)
  const calls: Array<{ name: string; tickers: string[]; limit: number }> = []
  const supabase = {
    rpc: async (name: string, args: { p_tickers: string[]; p_limit: number }) => {
      calls.push({ name, tickers: args.p_tickers, limit: args.p_limit })
      return {
        data: args.p_tickers.map((ticker) => ({
          ticker,
          rows: [compactRow(ticker, 0), compactRow(ticker, 1)],
        })),
        error: null,
      }
    },
  } as unknown as SupabaseClient

  const histories = await loadWyckoffV2CachedHistories(supabase, tickers)

  assert.equal(V2_CACHE_BATCH_SIZE, 5)
  assert.equal(histories.size, tickers.length)
  assert.equal(calls.length, 5)
  assert.ok(calls.every((call) => call.name === "qeo_market_ohlcv_recent_grouped"))
  assert.ok(calls.every((call) => call.tickers.length > 0 && call.tickers.length <= V2_CACHE_BATCH_SIZE))
  assert.ok(calls.every((call) => call.limit === DAILY_V2_CACHE_LIMIT))
  assert.deepEqual(calls.flatMap((call) => call.tickers), tickers)
})

test("cached history loader fails closed when a requested ticker is absent from grouped response", async () => {
  const supabase = {
    rpc: async () => ({ data: [{ ticker: "AAA", rows: [compactRow("AAA", 0), compactRow("AAA", 1)] }], error: null }),
  } as unknown as SupabaseClient

  await assert.rejects(
    () => loadWyckoffV2CachedHistories(supabase, ["AAA", "BBB"]),
    /BBB/,
  )
})
