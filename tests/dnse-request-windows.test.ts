import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { rewriteDnseBoardSubscriptionMessage } from "../modules/market/board/dnse-subscriptions.ts"
import {
  buildDnseRequestWindows,
  dnseWindowSpanDays,
  isRetryableDnseWindowError,
  splitDnseRequestWindow,
} from "../modules/market/providers/dnse/request-windows.ts"

test("DNSE Daily bootstrap keeps a 366-day fast path", () => {
  const from = 1_535_281_948
  const to = from + 800 * 86_400
  const windows = buildDnseRequestWindows(from, to, 366)
  assert.equal(windows.length, 3)
  assert.ok(dnseWindowSpanDays(windows[0]) >= 366)
  assert.equal(windows[0].from, from)
  assert.equal(windows.at(-1)?.to, to)
})

test("a failing large DNSE window can be split recursively without gaps", () => {
  const original = { from: 1_535_281_948, to: 1_566_904_348 }
  const first = splitDnseRequestWindow(original)
  assert.equal(first.length, 2)
  assert.equal(first[0].from, original.from)
  assert.equal(first[0].to + 1, first[1].from)
  assert.equal(first[1].to, original.to)

  const second = first.flatMap(splitDnseRequestWindow)
  assert.equal(second.length, 4)
  assert.equal(second[0].from, original.from)
  assert.equal(second.at(-1)?.to, original.to)
  for (let index = 1; index < second.length; index += 1) {
    assert.equal(second[index - 1].to + 1, second[index].from)
  }
})

test("adaptive DNSE split retries only transient failures", () => {
  for (const error of [
    new Error("The operation was aborted due to timeout"),
    new Error("fetch failed"),
    new Error("DNSE OHLC VGI 1D failed (500): upstream"),
    new Error("DNSE OHLC VGI 1D failed (429): rate limited"),
  ]) {
    assert.equal(isRetryableDnseWindowError(error), true, error.message)
  }

  assert.equal(isRetryableDnseWindowError(new Error("DNSE OHLC VGI 1D failed (401): unauthorized")), false)
  assert.equal(isRetryableDnseWindowError(new Error("DNSE OHLC VGI 1D failed (404): symbol not found")), false)
})

test("Daily transient retry floor is small enough to recover a VGI-like 23-day timeout", () => {
  const historySource = readFileSync("modules/market/providers/dnse/history.ts", "utf8")
  assert.match(historySource, /DAILY_MIN_RETRY_WINDOW_DAYS\s*=\s*7/)
  assert.doesNotMatch(historySource, /DAILY_MIN_RETRY_WINDOW_DAYS\s*=\s*45/)
})

test("DNSE board budget guard leaves popup orderbook subscription untouched", () => {
  const symbol = "VCB"
  const orderbook = JSON.stringify({
    action: "subscribe",
    channels: [
      { name: "tick.G1.json", symbols: [symbol] },
      { name: "top_price.G1.json", symbols: [symbol] },
      { name: "tick_extra.G1.json", symbols: [symbol] },
      { name: "ohlc.1.json", symbols: [symbol] },
      { name: "foreign.G1.json", symbols: [symbol] },
    ],
  })

  assert.equal(rewriteDnseBoardSubscriptionMessage(orderbook), orderbook)
})

test("QEO-175 gives Market Board a Supabase realtime transport instead of a browser DNSE socket", () => {
  const boardSource = readFileSync("components/live-market-board.tsx", "utf8")
  const streamSource = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")

  assert.doesNotMatch(boardSource, /new WebSocket\(authJson\.url\)/)
  assert.match(boardSource, /subscribeDnseMarketFrames/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.match(streamSource, /getSupabaseBrowserClient/)
  assert.match(streamSource, /market_realtime_bus/)
  assert.match(streamSource, /postgres_changes/)
  assert.match(streamSource, /synthesizeDnseOhlcFromTickMessage/)
})

test("QEO-175 realtime bus is authenticated-read, service-write, publication-enabled, and bounded", () => {
  const migration = readFileSync("supabase/migrations/20260912074500_qeo175_market_realtime_bus.sql", "utf8")

  assert.match(migration, /create table if not exists public\.market_realtime_bus/i)
  assert.match(migration, /frames jsonb not null/i)
  assert.match(migration, /sequence bigint not null/i)
  assert.match(migration, /grant select on public\.market_realtime_bus to authenticated/i)
  assert.match(migration, /to authenticated\s+using \(true\)/i)
  assert.match(migration, /supabase_realtime/i)
  assert.match(migration, /octet_length\(frames::text\)[\s\S]*524288/i)
})

test("QEO-175 Laravel worker is stateless, coalesces DNSE frames, and publishes at a bounded cadence", () => {
  const composer = readFileSync("services/market-realtime-worker/composer.json", "utf8")
  const command = readFileSync("services/market-realtime-worker/app/Console/Commands/StreamDnseMarket.php", "utf8")
  const buffer = readFileSync("services/market-realtime-worker/app/Market/MarketFrameBuffer.php", "utf8")
  const publisher = readFileSync("services/market-realtime-worker/app/Market/SupabaseRealtimeBus.php", "utf8")
  const railway = readFileSync("services/market-realtime-worker/railway.json", "utf8")

  assert.match(composer, /"laravel\/framework"\s*:\s*"\^12\.0"/)
  assert.match(command, /market:stream/)
  assert.match(command, /tick\.G1\.json/)
  assert.match(command, /market_index\.VNINDEX\.json/)
  assert.match(command, /MARKET_REALTIME_FLUSH_MS/)
  assert.match(command, /1000/)
  assert.match(buffer, /T[\s\S]*symbol|symbol[\s\S]*T/)
  assert.match(buffer, /524288/)
  assert.match(publisher, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(publisher, /market_realtime_bus/)
  assert.match(railway, /php artisan market:stream/)
  assert.doesNotMatch(railway, /volume|mount/i)
})
