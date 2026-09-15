import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-225 relay token is feature-gated, same-origin, HMAC signed, and short-lived", () => {
  const route = source("app/api/market/realtime-token/route.ts")
  const token = source("modules/market/realtime/relay-token.ts")

  assert.match(route, /requireApiFeature\("market_board"\)/)
  assert.match(route, /request\.headers\.get\("origin"\)/)
  assert.match(route, /QEO_MARKET_REALTIME_SIGNING_SECRET/)
  assert.match(route, /Cache-Control["']?:\s*["']no-store/)
  assert.match(route, /export async function POST/)
  assert.doesNotMatch(route, /export async function GET/)
  assert.doesNotMatch(route, /DNSE_API|SUPABASE_SERVICE_ROLE_KEY|DNSE_WS_URL/)

  assert.match(token, /createHmac\("sha256"/)
  assert.match(token, /digest\("base64url"\)/)
  assert.match(token, /MARKET_REALTIME_TOKEN_AUDIENCE = "qeo-market-realtime"/)
  assert.match(token, /MARKET_REALTIME_TOKEN_VERSION = 1/)
  assert.match(token, /MARKET_REALTIME_TOKEN_TTL_SECONDS = 60/)
  assert.match(token, /exp: issuedAt \+ MARKET_REALTIME_TOKEN_TTL_SECONDS/)
})

test("QEO-225 public relay URL is the only browser-visible relay configuration", () => {
  const env = source(".env.example")
  assert.match(env, /^NEXT_PUBLIC_QEO_MARKET_REALTIME_URL=$/m)
  assert.match(env, /^QEO_MARKET_REALTIME_SIGNING_SECRET=$/m)
  assert.doesNotMatch(env, /^NEXT_PUBLIC_QEO_MARKET_REALTIME_SIGNING_SECRET=/m)
})

test("QEO-225 worker relay is authenticated, loopback-bound, and removes Supabase from the hot path", () => {
  const config = source("services/market-realtime-worker/internal/config/config.go")
  const compose = source("services/market-realtime-worker/deploy/upcloud/docker-compose.upcloud.yml")
  const run = source("services/market-realtime-worker/internal/worker/run.go")

  assert.match(config, /QEO_MARKET_REALTIME_SIGNING_SECRET/)
  assert.match(config, /QEO_MARKET_REALTIME_ALLOWED_ORIGINS/)
  assert.match(config, /QEO_MARKET_REALTIME_LISTEN_ADDR/)
  assert.match(compose, /127\.0\.0\.1:8787:8787/)
  assert.doesNotMatch(run, /PublishPrivateBroadcast/)
})

test("QEO-225 browser adapters use one shared relay transport instead of Supabase Realtime", () => {
  const relay = source("modules/market/realtime/relay-client.ts")
  const market = source("modules/market/providers/dnse/market-stream.ts")
  const orderbook = source("modules/market/providers/dnse/orderbook-stream.ts")

  assert.match(relay, /NEXT_PUBLIC_QEO_MARKET_REALTIME_URL/)
  assert.match(relay, /\/api\/market\/realtime-token/)
  assert.match(relay, /new WebSocket\(/)
  assert.match(relay, /type:\s*["']auth["']/)
  assert.doesNotMatch(relay, /\?token=|searchParams.*token/i)

  assert.match(market, /subscribeMarketRelay/)
  assert.doesNotMatch(market, /postgres_changes/)
  assert.match(orderbook, /subscribeMarketRelay/)
  assert.doesNotMatch(orderbook, /\.channel\(|private:\s*true|broadcast/)
})
