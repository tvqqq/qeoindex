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

test("QEO-175 gives Market Board a Supabase realtime transport instead of a browser DNSE socket", () => {
  const boardSource = readFileSync("components/live-market-board.tsx", "utf8")
  const streamSource = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")

  assert.doesNotMatch(boardSource, /new WebSocket\(authJson\.url\)/)
  assert.match(boardSource, /subscribeDnseMarketFrames/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.match(streamSource, /getAuthenticatedSupabaseRealtimeClient/)
  assert.match(streamSource, /market_realtime_bus/)
  assert.match(streamSource, /postgres_changes/)
  assert.match(streamSource, /synthesizeDnseOhlcFromTickMessage/)
})

test("QEO-196 shared auth boundary precedes Market Board bootstrap and CDC join", () => {
  const helper = readFileSync("modules/shared/supabase/authenticated-realtime.ts", "utf8")
  const source = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")

  const getSessionIndex = helper.indexOf("await supabase.auth.getSession()")
  const setAuthIndex = helper.indexOf("await supabase.realtime.setAuth(session.access_token)")
  assert.ok(getSessionIndex >= 0, "shared startup must hydrate the browser Supabase session")
  assert.ok(setAuthIndex > getSessionIndex, "Realtime must receive the authenticated access token after hydration")

  const start = source.indexOf("async function startSupabaseRealtime")
  assert.notEqual(start, -1, "market stream must retain an auth-gated async startup path")
  const body = source.slice(start, source.indexOf("export function publishDnseMarketFrame"))
  const helperIndex = body.indexOf("await getAuthenticatedSupabaseRealtimeClient()")
  const bootstrapIndex = body.indexOf("await bootstrapCurrentRow(supabase)")
  const channelIndex = body.indexOf(".channel(CHANNEL_NAME)")
  assert.ok(helperIndex >= 0, "Market Board startup must use the shared auth gate")
  assert.ok(bootstrapIndex > helperIndex, "authenticated bootstrap must happen after the shared auth gate")
  assert.ok(channelIndex > bootstrapIndex, "CDC subscription must happen only after authenticated bootstrap")
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

test("QEO-216 removes browser-direct DNSE orderbook transport", () => {
  const transportPath = "modules/market/providers/dnse/orderbook-stream.ts"
  assert.equal(existsSync(transportPath), true, "QEO-216 centralized orderbook transport must exist")

  const panel = readFileSync("components/orderbook/live-orderbook-panel.tsx", "utf8")
  const transport = readFileSync(transportPath, "utf8")

  assert.doesNotMatch(panel, /new WebSocket\(authJson\.url\)/)
  assert.doesNotMatch(panel, /\/api\/market\/stream-auth/)
  assert.match(panel, /subscribeDnseOrderbookFrames/)
  assert.match(transport, /private:\s*true/)
  assert.match(transport, /broadcast/)
  assert.doesNotMatch(transport, /ws-openapi\.dnse\.com\.vn/)
})

test("QEO-216 shares the QEO-196 auth hydration boundary before private Realtime joins", () => {
  const helperPath = "modules/shared/supabase/authenticated-realtime.ts"
  const transportPath = "modules/market/providers/dnse/orderbook-stream.ts"
  assert.equal(existsSync(helperPath), true, "shared authenticated Realtime helper must exist")
  assert.equal(existsSync(transportPath), true, "centralized orderbook transport must exist")

  const helper = readFileSync(helperPath, "utf8")
  const orderbook = readFileSync(transportPath, "utf8")
  const market = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")

  const getSession = helper.indexOf("await supabase.auth.getSession()")
  const setAuth = helper.indexOf("await supabase.realtime.setAuth(session.access_token)")
  assert.ok(getSession >= 0, "helper must hydrate the browser auth session")
  assert.ok(setAuth > getSession, "Realtime auth must be set after session hydration")
  assert.match(orderbook, /await getAuthenticatedSupabaseRealtimeClient\(\)/)
  assert.match(market, /await getAuthenticatedSupabaseRealtimeClient\(\)/)

  const orderbookAuth = orderbook.indexOf("await getAuthenticatedSupabaseRealtimeClient()")
  const orderbookChannel = orderbook.indexOf(".channel(topic, { config: { private: true } })")
  assert.ok(orderbookAuth >= 0 && orderbookChannel > orderbookAuth, "private Broadcast join must occur after auth hydration")
})

test("QEO-216 worker uses four bounded supplemental sockets and reuses canonical ticks", () => {
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
  assert.match(config, /ORDERBOOK_REALTIME_FLUSH_MS/)
  assert.match(config, /500/)
  assert.doesNotMatch(stream, /func OrderbookChannels[\s\S]*ohlc\.1\.json/)
})

test("QEO-216 private Broadcast authorization is scoped to authenticated orderbook listeners", () => {
  const migrationPath = "supabase/migrations/20260914090000_qeo216_orderbook_realtime_broadcast.sql"
  assert.equal(existsSync(migrationPath), true, "QEO-216 Realtime authorization migration must exist")

  const migration = readFileSync(migrationPath, "utf8")
  assert.match(migration, /on\s+"?realtime"?\."?messages"?/i)
  assert.match(migration, /for\s+select/i)
  assert.match(migration, /to\s+authenticated/i)
  assert.match(migration, /realtime\.topic\(\)/i)
  assert.match(migration, /orderbook:v1:/i)
  assert.match(migration, /extension[\s\S]*broadcast/i)
  assert.doesNotMatch(migration, /for\s+insert[\s\S]*to\s+authenticated/i)
})