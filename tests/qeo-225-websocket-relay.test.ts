import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("QEO-225 token route is feature-gated and never puts the capability in a URL", () => {
  const route = readFileSync("app/api/market/realtime-token/route.ts", "utf8")
  const token = readFileSync("modules/market/realtime/relay-token.ts", "utf8")
  const client = readFileSync("modules/market/realtime/relay-client.ts", "utf8")

  assert.match(route, /requireApiFeature\("market_board"\)/)
  assert.match(route, /QEO_MARKET_REALTIME_SIGNING_SECRET/)
  assert.match(route, /Cache-Control["']?:\s*["']no-store/)
  assert.match(token, /MARKET_REALTIME_TOKEN_TTL_SECONDS\s*=\s*60/)
  assert.match(client, /fetch\("\/api\/market\/realtime-token"/)
  assert.match(client, /new WebSocket\(url\)/)
  assert.match(client, /JSON\.stringify\(\{ type: "auth", token \}\)/)
  assert.doesNotMatch(client, /new WebSocket\([^\n]*(token|access_token|apikey)/i)
})

test("QEO-225 browser market and orderbook live paths use one relay transport while Supabase remains bootstrap only", () => {
  const market = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")
  const orderbook = readFileSync("modules/market/providers/dnse/orderbook-stream.ts", "utf8")
  const relay = readFileSync("modules/market/realtime/relay-client.ts", "utf8")

  assert.match(market, /subscribeMarketRelay/)
  assert.match(orderbook, /subscribeMarketRelay/)
  assert.match(market, /market_realtime_bus/)
  assert.match(orderbook, /market_realtime_bus/)
  assert.doesNotMatch(market, /postgres_changes/)
  assert.doesNotMatch(orderbook, /\.on\("broadcast"/)
  assert.doesNotMatch(orderbook, /private:\s*true/)
  assert.match(relay, /let socket: WebSocket \| null = null/)
  assert.match(relay, /const topicListeners = new Map/)
})

test("QEO-225 worker fans out in-memory before asynchronous Supabase checkpoints", () => {
  const worker = readFileSync("services/market-realtime-worker/internal/worker/run.go", "utf8")
  const checkpoint = readFileSync("services/market-realtime-worker/internal/worker/checkpoint_writer.go", "utf8")

  assert.match(worker, /relay\.NewHub/)
  assert.match(worker, /relay\.NewServer/)
  assert.match(worker, /RelayMarketFlushInterval/)
  assert.match(worker, /RelayOrderbookFlushInterval/)
  assert.match(worker, /hub\.Publish\("market"/)
  assert.match(worker, /hub\.Publish\("orderbook:"\+symbol/)
  assert.match(worker, /newCheckpointWriter/)
  assert.doesNotMatch(worker, /newOrderbookPublisher/)
  assert.match(checkpoint, /go writer\.run\(\)/)
  assert.match(checkpoint, /PublishCheckpoint/)
})

test("QEO-225 UpCloud relay port is bound only to host loopback", () => {
  const compose = readFileSync("services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml", "utf8")
  const config = readFileSync("services/market-realtime-worker/internal/config/config.go", "utf8")

  assert.match(compose, /127\.0\.0\.1:8787:8787/)
  assert.doesNotMatch(compose, /["']0\.0\.0\.0:8787:8787["']/)
  assert.match(config, /QEO_MARKET_REALTIME_ALLOWED_ORIGINS/)
  assert.match(config, /cannot contain wildcard/)
  assert.match(config, /QEO_MARKET_REALTIME_MARKET_FLUSH_MS["'],\s*100/)
  assert.match(config, /QEO_MARKET_REALTIME_ORDERBOOK_FLUSH_MS["'],\s*50/)
})
