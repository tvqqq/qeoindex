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

test("market history cooldown reuses the DNSE transient failure classifier", () => {
  const marketHistorySource = readFileSync("modules/market/history/index.ts", "utf8")
  assert.match(marketHistorySource, /isRetryableDnseWindowError/)
  assert.match(marketHistorySource, /function markDnseUnavailable[\s\S]*isRetryableDnseWindowError\(error\)/)
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

test("QEO-225 gives Market Board an authenticated relay hot path without a browser provider socket", () => {
  const boardSource = readFileSync("components/live-market-board.tsx", "utf8")
  const streamSource = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")
  const relaySource = readFileSync("modules/market/realtime/relay-client.ts", "utf8")

  assert.doesNotMatch(boardSource, /new WebSocket\(authJson\.url\)/)
  assert.match(boardSource, /subscribeDnseMarketFrames/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.match(streamSource, /getAuthenticatedSupabaseRealtimeClient/)
  assert.match(streamSource, /market_realtime_bus/)
  assert.match(streamSource, /subscribeMarketRelay/)
  assert.doesNotMatch(streamSource, /postgres_changes|\.channel\(/)
  assert.match(streamSource, /synthesizeDnseOhlcFromTickMessage/)
  assert.match(relaySource, /\/api\/market\/realtime-token/)
  assert.match(relaySource, /new WebSocket\(url\)/)
})

test("QEO-225 authenticates relay before subscribing while Supabase is bootstrap-only", () => {
  const relay = readFileSync("modules/market/realtime/relay-client.ts", "utf8")
  const market = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")
  const orderbook = readFileSync("modules/market/providers/dnse/orderbook-stream.ts", "utf8")

  const openIndex = relay.indexOf("new WebSocket(url)")
  const authIndex = relay.indexOf('type: "auth", token')
  const subscribeIndex = relay.indexOf('type: "subscribe", topics')
  assert.ok(openIndex >= 0, "relay transport must create one physical browser WebSocket")
  assert.ok(authIndex > openIndex, "relay token must be sent after WebSocket open")
  assert.ok(subscribeIndex > authIndex, "logical subscriptions must follow relay authentication")
  assert.doesNotMatch(relay, /\?token=|searchParams.*token/i)
  assert.match(market, /await getAuthenticatedSupabaseRealtimeClient\(\)/)
  assert.match(orderbook, /await getAuthenticatedSupabaseRealtimeClient\(\)/)
  assert.doesNotMatch(market, /supabase\.realtime|postgres_changes|\.channel\(/)
  assert.doesNotMatch(orderbook, /supabase\.realtime|private:\s*true|\.on\("broadcast"|\.channel\(/)
})

test("QEO-225 relay token route is feature-gated, short-lived, and not URL-borne", () => {
  const route = readFileSync("app/api/market/realtime-token/route.ts", "utf8")
  const token = readFileSync("modules/market/realtime/relay-token.ts", "utf8")
  const client = readFileSync("modules/market/realtime/relay-client.ts", "utf8")

  assert.match(route, /requireApiFeature\("market_board"\)/)
  assert.match(route, /QEO_MARKET_REALTIME_SIGNING_SECRET/)
  assert.match(route, /Cache-Control["']?:\s*["']no-store/)
  assert.match(token, /MARKET_REALTIME_TOKEN_TTL_SECONDS\s*=\s*60/)
  assert.match(client, /fetch\("\/api\/market\/realtime-token"/)
  assert.match(client, /JSON\.stringify\(\{ type: "auth", token \}\)/)
  assert.doesNotMatch(client, /new WebSocket\([^\n]*(token|access_token|apikey)/i)
})

test("QEO-175 realtime bus remains authenticated recovery storage and bounded", () => {
  const migration = readFileSync("supabase/migrations/20260912074500_qeo175_market_realtime_bus.sql", "utf8")

  assert.match(migration, /create table if not exists public\.market_realtime_bus/i)
  assert.match(migration, /frames jsonb not null/i)
  assert.match(migration, /sequence bigint not null/i)
  assert.match(migration, /grant select on public\.market_realtime_bus to authenticated/i)
  assert.match(migration, /to authenticated\s+using \(true\)/i)
  assert.match(migration, /supabase_realtime/i)
  assert.match(migration, /octet_length\(frames::text\)[\s\S]*524288/i)
})

test("QEO-225 worker keeps durable checkpoints bounded while relay owns live delivery", () => {
  const stream = readFileSync("services/market-realtime-worker/internal/dnse/stream.go", "utf8")
  const config = readFileSync("services/market-realtime-worker/internal/config/config.go", "utf8")
  const buffer = readFileSync("services/market-realtime-worker/internal/realtime/buffer.go", "utf8")
  const publisher = readFileSync("services/market-realtime-worker/internal/supabase/client.go", "utf8")
  const worker = readFileSync("services/market-realtime-worker/internal/worker/run.go", "utf8")
  const checkpoint = readFileSync("services/market-realtime-worker/internal/worker/checkpoint_writer.go", "utf8")

  assert.match(stream, /tick\.G1\.json/)
  assert.match(stream, /market_index\.VNINDEX\.json/)
  assert.match(config, /MARKET_REALTIME_FLUSH_MS/)
  assert.match(config, /QEO_MARKET_REALTIME_MARKET_FLUSH_MS/)
  assert.match(config, /QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS/)
  assert.match(buffer, /524288/)
  assert.match(publisher, /market_realtime_bus/)
  assert.match(publisher, /CurrentSequence/)
  assert.match(worker, /relay\.NewHub/)
  assert.match(worker, /relay\.NewServer/)
  assert.match(worker, /hub\.Publish\(\s*"market"/)
  assert.match(worker, /hub\.Publish\(\s*"orderbook:"\+symbol/)
  assert.match(worker, /newCheckpointWriter/)
  assert.doesNotMatch(worker, /newOrderbookPublisher/)
  assert.doesNotMatch(worker, /PublishPrivateBroadcast/)
  assert.match(checkpoint, /go writer\.run\(\)/)
  assert.match(checkpoint, /PublishCheckpoint/)
})

test("QEO-196 keeps the bounded Go worker runtime foundation", () => {
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

  assert.equal(existsSync("services/market-realtime-worker/railway.json"), false)
  assert.equal(existsSync("services/market-realtime-worker/composer.json"), false)
})

test("QEO-225 exposes the worker relay on loopback only and keeps existing market timers", () => {
  const dockerfilePath = "services/market-realtime-worker/Dockerfile"
  const composePath = "services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml"
  const servicePath = "services/market-realtime-worker/deploy/upcloud/qeo-market-realtime.service"
  const startTimerPath = "services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-start.timer"
  const stopTimerPath = "services/market-realtime-worker/deploy/upcloud/qeo-market-realtime-stop.timer"

  for (const path of [dockerfilePath, composePath, servicePath, startTimerPath, stopTimerPath]) {
    assert.equal(existsSync(path), true, `missing UpCloud artifact: ${path}`)
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
  assert.match(compose, /127\.0\.0\.1:8787:8787/)
  assert.doesNotMatch(compose, /["']0\.0\.0\.0:8787:8787["']/)
  assert.match(service, /WorkingDirectory=\/opt\/qeoindex\/repo\/services\/market-realtime-worker/)
  assert.match(service, /--no-build/)
  assert.match(startTimer, /01:55:00\s+UTC/)
  assert.match(startTimer, /Persistent=true/)
  assert.match(stopTimer, /07:50:00\s+UTC/)
  assert.match(stopTimer, /Persistent=true/)
})

test("QEO-225 removes browser-direct provider orderbook transport and Supabase Broadcast hot path", () => {
  const transportPath = "modules/market/providers/dnse/orderbook-stream.ts"
  assert.equal(existsSync(transportPath), true, "centralized orderbook transport must exist")

  const panel = readFileSync("components/orderbook/live-orderbook-panel.tsx", "utf8")
  const transport = readFileSync(transportPath, "utf8")

  assert.doesNotMatch(panel, /new WebSocket\(authJson\.url\)/)
  assert.doesNotMatch(panel, /\/api\/market\/stream-auth/)
  assert.match(panel, /subscribeDnseOrderbookFrames/)
  assert.match(transport, /subscribeMarketRelay/)
  assert.doesNotMatch(transport, /private:\s*true|\.on\("broadcast"|\.channel\(/)
  assert.doesNotMatch(transport, /ws-openapi\.dnse\.com\.vn/)
})

test("QEO-216 provider ownership still uses four bounded supplemental sockets and reuses canonical ticks", () => {
  const planPath = "services/market-realtime-worker/internal/worker/orderbook_plan.go"
  const bufferPath = "services/market-realtime-worker/internal/realtime/orderbook_buffer.go"
  assert.equal(existsSync(planPath), true, "orderbook provider shard planner must exist")
  assert.equal(existsSync(bufferPath), true, "orderbook fanout buffer must exist")

  const stream = readFileSync("services/market-realtime-worker/internal/dnse/stream.go", "utf8")
  const plan = readFileSync(planPath, "utf8")
  const worker = readFileSync("services/market-realtime-worker/internal/worker/run.go", "utf8")
  const config = readFileSync("services/market-realtime-worker/internal/config/config.go", "utf8")

  assert.match(stream, /top_price\.G1\.json/)
  assert.match(stream, /tick_extra\.G1\.json/)
  assert.match(stream, /foreign\.G1\.json/)
  assert.match(plan, /maxOrderbookSymbolsPerSocket\s*=\s*50/)
  assert.match(plan, /maxOrderbookSupplementalSockets\s*=\s*4/)
  assert.match(worker, /orderbook-0/)
  assert.match(worker, /onTickFrame[\s\S]*orderbookBuffer\.Push/)
  assert.match(config, /QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS/)
  assert.match(config, /50/)
  assert.doesNotMatch(stream, /func OrderbookChannels[\s\S]*ohlc\.1\.json/)
})

test("QEO-216 historical private Broadcast policy remains scoped even though QEO-225 no longer consumes it", () => {
  const migrationPath = "supabase/migrations/20260914090000_qeo216_orderbook_realtime_broadcast.sql"
  assert.equal(existsSync(migrationPath), true, "QEO-216 Realtime authorization migration must remain auditable")

  const migration = readFileSync(migrationPath, "utf8")
  assert.match(migration, /on\s+"?realtime"?\."?messages"?/i)
  assert.match(migration, /for\s+select/i)
  assert.match(migration, /to\s+authenticated/i)
  assert.match(migration, /realtime\.topic\(\)/i)
  assert.match(migration, /orderbook:v1:/i)
  assert.match(migration, /extension[\s\S]*broadcast/i)
  assert.doesNotMatch(migration, /for\s+insert[\s\S]*to\s+authenticated/i)
})

test("QEO-223 keeps backend provider topology private in Market Board status UI", () => {
  const boardSource = readFileSync("components/live-market-board.tsx", "utf8")
  const statusStart = boardSource.indexOf("const FloatingMarketStatus")
  const statusEnd = boardSource.indexOf("function extractInitialRefs")
  assert.ok(statusStart >= 0 && statusEnd > statusStart, "FloatingMarketStatus component must exist")
  const statusSource = boardSource.slice(statusStart, statusEnd)

  assert.match(statusSource, /REALTIME LIVE/)
  assert.doesNotMatch(statusSource, /DNSE LIVE/)
  assert.doesNotMatch(statusSource, /Nguồn dữ liệu:/)
  assert.doesNotMatch(statusSource, /Yahoo 5m \+ DNSE via Supabase/)
  assert.doesNotMatch(statusSource, /UPCLOUD RELAY LIVE/)
})