import assert from "node:assert/strict"
import test from "node:test"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { NotionPage } from "../lib/notion/client.ts"
import { parseWyckoffV2UniversePage } from "../lib/wyckoff-v2-universe-source.ts"
import {
  DAILY_V2_CACHE_LIMIT,
  cachedHistoryFromRows,
  loadWyckoffV2CachedHistories,
} from "../lib/wyckoff-v2-cache-read.ts"

function universePage(input: { ticker: string; active?: boolean; exchange?: string; rank?: number | null; sector?: string }): NotionPage {
  return {
    id: `page-${input.ticker}`,
    properties: {
      Ticker: { title: [{ plain_text: input.ticker }] },
      Active: { checkbox: { checked: input.active ?? true } },
      Exchange: { select: { name: input.exchange ?? "HOSE" } },
      Rank: { number: input.rank === undefined ? 1 : input.rank },
      Sector: { rich_text: [{ plain_text: input.sector ?? "Consumer" }] },
    },
  }
}

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

test("v2 universe source preserves missing Rank instead of dropping the ticker", () => {
  const row = parseWyckoffV2UniversePage(universePage({ ticker: "TCX", rank: null }))
  assert.deepEqual(row, { ticker: "TCX", active: true, exchange: "HOSE", rank: null, sector: "Consumer" })
})

test("v2 universe source preserves explicit exchange and active state for hard-stop validation", () => {
  const row = parseWyckoffV2UniversePage(universePage({ ticker: "ABC", active: false, exchange: "HNX", rank: 12, sector: "Banks" }))
  assert.deepEqual(row, { ticker: "ABC", active: false, exchange: "HNX", rank: 12, sector: "Banks" })
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

test("cached history loader batches ticker reads instead of issuing one query per ticker", async () => {
  const tickers = Array.from({ length: 25 }, (_, index) => `T${String(index + 1).padStart(3, "0")}`)
  const calls: Array<{ tickers: string[]; limit: number }> = []
  const supabase = {
    rpc: async (_name: string, args: { p_tickers: string[]; p_limit: number }) => {
      calls.push({ tickers: args.p_tickers, limit: args.p_limit })
      return {
        data: args.p_tickers.flatMap((ticker) => [cachedRow(ticker, 0), cachedRow(ticker, 1)]),
        error: null,
      }
    },
  } as unknown as SupabaseClient

  const histories = await loadWyckoffV2CachedHistories(supabase, tickers)

  assert.equal(histories.size, tickers.length)
  assert.equal(calls.length, 3)
  assert.ok(calls.every((call) => call.tickers.length > 0 && call.tickers.length <= 10))
  assert.ok(calls.every((call) => call.limit === DAILY_V2_CACHE_LIMIT))
  assert.deepEqual(calls.flatMap((call) => call.tickers), tickers)
})

test("cached history loader fails closed when a requested ticker is absent from the batch response", async () => {
  const supabase = {
    rpc: async () => ({ data: [cachedRow("AAA", 0), cachedRow("AAA", 1)], error: null }),
  } as unknown as SupabaseClient

  await assert.rejects(
    () => loadWyckoffV2CachedHistories(supabase, ["AAA", "BBB"]),
    /BBB/,
  )
})
