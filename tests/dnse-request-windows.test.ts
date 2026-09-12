import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
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

test("QEO-175 centralized worker contract remains bounded after the QEO-196 runtime cutover", () => {
  const stream = readFileSync("services/market-realtime-worker/internal/dnse/stream.go", "utf8")
  const config = readFileSync("services/market-realtime-worker/internal/config/config.go", "utf8")
  const buffer = readFileSync("services/market-realtime-worker/internal/realtime/buffer.go", "utf8")
  const publisher = readFileSync("services/market-realtime-worker/internal/supabase/client.go", "utf8")
  const worker = readFileSync("services/market-realtime-worker/internal/worker/run.go", "utf8")

  assert.match(stream, /tick\.G1\.json/)
  assert.match(stream, /market_index\.VNINDEX\.json/)
  assert.match(config, /MARKET_REALTIME_FLUSH_MS/)
  assert.match(config, /1000/)
  assert.match(config, /MARKET_UNIVERSE_REFRESH_MS/)
  assert.match(config, /300000/)
  assert.match(buffer, /524288/)
  assert.match(publisher, /SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey/)
  assert.match(publisher, /market_realtime_bus/)
  assert.match(publisher, /CurrentSequence/)
  assert.match(worker, /NextSequence/)
})

test("QEO-196 cuts the centralized realtime runtime over to a bounded Go worker", () => {
  const goModPath = "services/market-realtime-worker/go.mod"
  const mainPath = "services/market-realtime-worker/cmd/market-realtime-worker/main.go"
  const configPath = "services/market-realtime-worker/internal/config/config.go"
  const streamPath = "services/market-realtime-worker/internal/dnse/stream.go"
  const workerPath = "services/market-realtime-worker/internal/worker/run.go"
  const supabasePath = "services/market-realtime-worker/internal/supabase/client.go"

  for (const path of [goModPath, mainPath, configPath, streamPath, workerPath, supabasePath]) {
    assert.equal(existsSync(path), true, `missing QEO-196 Go worker artifact: ${path}`)
  }

  const mainSource = readFileSync(mainPath, "utf8")
  const configSource = readFileSync(configPath, "utf8")
  const streamSource = readFileSync(streamPath, "utf8")
  const workerSource = readFileSync(workerPath, "utf8")
  const supabaseSource = readFileSync(supabasePath, "utf8")

  assert.match(mainSource, /slog\.NewJSONHandler/)
  assert.match(mainSource, /signal\.NotifyContext/)
  assert.match(streamSource, /tick\.G1\.json/)
  assert.match(streamSource, /market_index\.VNINDEX\.json/)
  assert.match(streamSource, /stale/i)
  assert.match(streamSource, /backoff/i)
  assert.match(configSource, /Asia\/Ho_Chi_Minh/)
  assert.match(configSource, /08:55/)
  assert.match(configSource, /14:50/)
  assert.match(configSource, /MARKET_UNIVERSE_REFRESH_MS/)
  assert.match(supabaseSource, /market_realtime_bus/)
  assert.match(supabaseSource, /CurrentSequence/)
  assert.match(workerSource, /NextSequence/)

  assert.equal(existsSync("services/market-realtime-worker/railway.json"), false)
  assert.equal(existsSync("services/market-realtime-worker/composer.json"), false)
})

test("QEO-196 UpCloud runtime has no public port and is fail-closed until E2E timer enablement", () => {
  const dockerfilePath = "services/market-realtime-worker/Dockerfile"
  const composePath = "services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml"
  const servicePath = "services/market-realtime-worker/deploy/upcloud/qeo-market-realtime.service"
  const startTimerPath = "services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-start.timer"
  const stopTimerPath = "services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-stop.timer"

  for (const path of [dockerfilePath, composePath, servicePath, startTimerPath, stopTimerPath]) {
    assert.equal(existsSync(path), true, `missing QEO-196 UpCloud artifact: ${path}`)
  }

  const dockerfile = readFileSync(dockerfilePath, "utf8")
  const compose = readFileSync(composePath, "utf8")
  const service = readFileSync(servicePath, "utf8")
  const startTimer = readFileSync(startTimerPath, "utf8")
  const stopTimer = readFileSync(stopTimerPath, "utf8")

  assert.doesNotMatch(dockerfile, /^EXPOSE\s/im)
  assert.match(dockerfile, /USER\s+/i)
  assert.match(compose, /mem_limit:\s*384m/i)
  assert.match(compose, /cpus:\s*["']?0\.[0-9]+/i)
  assert.match(compose, /\/opt\/qeoindex\/env\/market-realtime-worker\.env/)
  assert.doesNotMatch(compose, /ports:/i)
  assert.match(service, /WorkingDirectory=\/opt\/qeoindex\/repo\/services\/market-realtime-worker/)
  assert.match(service, /--no-build/)
  assert.match(startTimer, /01:55:00\s+UTC/)
  assert.match(startTimer, /Persistent=true/)
  assert.match(stopTimer, /07:50:00\s+UTC/)
  assert.match(stopTimer, /Persistent=true/)
})
