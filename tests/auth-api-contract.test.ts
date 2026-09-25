import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const FEATURE_ROUTES: Array<[string, string]> = [
  ["app/api/market/intraday/route.ts", "market_board"],
  ["app/api/market/indexes/route.ts", "market_board"],
  ["app/api/market/index-candles/route.ts", "market_board"],
  ["app/api/market/session/route.ts", "market_board"],
  ["app/api/market/put-through/route.ts", "market_board"],
  ["app/api/market/stream-auth/route.ts", "market_board"],
  ["app/api/finhay/status/route.ts", "finhay_live"],
  ["app/api/finhay/quote/route.ts", "finhay_live"],
  ["app/api/finhay/auth/start/route.ts", "finhay_live"],
  ["app/api/finhay/auth/callback/route.ts", "finhay_live"],
  ["app/api/finhay/auth/disconnect/route.ts", "finhay_live"],
  ["app/api/research/promote/route.ts", "research"],
  ["app/api/scanner/health/route.ts", "research"],
  ["app/api/signals/health/route.ts", "signals"],
]

test("browser-facing API routes enforce server auth and feature access", () => {
  for (const [path, feature] of FEATURE_ROUTES) {
    const code = source(path)
    assert.match(code, /requireApiFeature/, `${path} must use requireApiFeature`)
    assert.ok(code.includes(`requireApiFeature("${feature}")`), `${path} must require ${feature}`)
  }
})

test("per-user account, watchlist, and insights APIs derive access from server auth", () => {
  const me = source("app/api/me/route.ts")
  assert.match(me, /requireApiUser/)
  assert.match(me, /auth\.context\.user\.id/)

  const watchlistServer = source("modules/portfolio/watchlist/server.ts")
  assert.match(watchlistServer, /requireApiUser/)
  assert.match(watchlistServer, /auth\.context\.user\.id/)

  const watchlistRoute = source("app/api/watchlist/route.ts")
  assert.match(watchlistRoute, /@\/modules\/portfolio\/watchlist\/server/)

  const wyckoff = source("app/api/insights/wyckoff/route.ts")
  assert.match(wyckoff, /requireApiUser/)
  assert.match(wyckoff, /auth\.context\.supabase/)
})

test("QEO-280 watchlist API exposes owned-list selection, create compatibility, and reorder persistence", () => {
  const route = source("app/api/watchlist/route.ts")
  const server = source("modules/portfolio/watchlist/server.ts")

  assert.match(route, /export const PUT = handleWatchlistPut/)
  assert.match(route, /export const PATCH = handleWatchlistPatch/)
  assert.match(server, /new URL\(request\.url\)\.searchParams\.get\("wid"\)/)
  assert.match(server, /activeWatchlistId: watchlist\.id/)
  assert.match(server, /body\?\.watchlistId \?\? body\?\.watchlist_id/)
  assert.match(server, /body\?\.sortOrder \?\? body\?\.sort_order/)
  assert.match(server, /handleWatchlistPatch/)
  assert.match(server, /Thứ tự watchlist đã thay đổi/)
  assert.match(server, /\.eq\("user_id", auth\.context\.user\.id\)/)
})

test("QEO-282 Watchlist management mutations remain owner-scoped", () => {
  const server = source("modules/portfolio/watchlist/server.ts")

  assert.match(server, /action === "reorder-watchlists"/)
  assert.match(server, /action === "rename-watchlist"/)
  assert.match(server, /watchlistIds/)
  assert.match(server, /\.update\(\{ sort_order: index \}\)/)
  assert.match(server, /\.update\(\{ name \}\)/)
  assert.match(server, /\.eq\("user_id", auth\.context\.user\.id\)/)
  assert.match(server, /promotedDefaultId/)
  assert.match(server, /\.update\(\{ is_default: true \}\)/)
})

test("server-rendered app surfaces verify the server session", () => {
  assert.match(source("app/page.tsx"), /getServerAuthContext/)
  assert.match(source("app/insights/wyckoff/page.tsx"), /getServerAuthContext/)
  assert.match(source("app/research/layout.tsx"), /getServerAuthContext/)
  assert.match(source("components/auth/app-auth-gate.tsx"), /syncServerSession/)
})

test("machine endpoints share constant-time bearer authorization", () => {
  const machineAuth = source("modules/auth/machine.ts")
  assert.match(machineAuth, /timingSafeEqual/)
  assert.match(machineAuth, /createHash\("sha256"\)/)

  const routes: Array<[string, RegExp]> = [
    ["app/api/signals/daily/route.ts", /CRON_SECRET/],
    ["app/api/signals/monitor/route.ts", /SIGNAL_MONITOR_SECRET/],
    ["app/api/scanner/run/route.ts", /SCANNER_RUN_SECRET/],
    ["app/api/wyckoff/ingest/route.ts", /CRON_SECRET/],
    ["app/api/market/cache/invalidate/route.ts", /MARKET_CACHE_ADMIN_SECRET/],
    ["app/api/market/sync-universe/route.ts", /MARKET_SYNC_SECRET/],
  ]

  for (const [path, secretPattern] of routes) {
    const code = source(path)
    assert.match(code, /isMachineRequestAuthorized/, `${path} must use shared machine auth`)
    assert.match(code, secretPattern, `${path} must keep its dedicated secret`)
  }
})

test("destructive market maintenance endpoints are POST-only", () => {
  for (const path of ["app/api/market/cache/invalidate/route.ts", "app/api/market/sync-universe/route.ts"]) {
    const code = source(path)
    assert.match(code, /export async function POST/)
    assert.doesNotMatch(code, /export async function GET/)
  }
})

test("trusted Supabase infrastructure client never falls back to public anon credentials", () => {
  const code = source("modules/shared/supabase/server.ts")
  assert.match(code, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.doesNotMatch(code, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
})

const SERVER_AUTH_OBSERVABILITY_URL = new URL("../modules/auth/server-observability.ts", import.meta.url)

async function loadServerAuthObservability() {
  const exists = existsSync(SERVER_AUTH_OBSERVABILITY_URL)
  assert.equal(exists, true, "QEO-41 requires a dedicated server-auth observability helper")
  if (!exists) return null
  return import(SERVER_AUTH_OBSERVABILITY_URL.href)
}

test("server auth timeout observability emits only stable sanitized fields", async () => {
  const observability = await loadServerAuthObservability()
  if (!observability) return

  const events: unknown[] = []
  const timeoutError = Object.assign(
    new Error("Bearer secret-access-token failed for user@example.com after timeout"),
    { name: "TimeoutError" },
  )

  observability.reportServerAuthTransportFailure(timeoutError, (event: unknown) => events.push(event))

  assert.deepEqual(events, [
    {
      event: "server_auth_transport_failure",
      operation: "supabase.auth.getUser",
      category: "timeout",
    },
  ])
  const serialized = JSON.stringify(events)
  assert.equal(serialized.includes("secret-access-token"), false)
  assert.equal(serialized.includes("user@example.com"), false)
  assert.equal(serialized.includes("Bearer"), false)
})

test("server auth transport observability distinguishes abort and generic transport failures", async () => {
  const observability = await loadServerAuthObservability()
  if (!observability) return

  const events: unknown[] = []
  const logger = (event: unknown) => events.push(event)

  observability.reportServerAuthTransportFailure(
    Object.assign(new Error("aborted with secret-access-token"), { name: "AbortError" }),
    logger,
  )
  observability.reportServerAuthTransportFailure(new Error("fetch failed for user@example.com"), logger)

  assert.deepEqual(events, [
    {
      event: "server_auth_transport_failure",
      operation: "supabase.auth.getUser",
      category: "abort",
    },
    {
      event: "server_auth_transport_failure",
      operation: "supabase.auth.getUser",
      category: "transport",
    },
  ])
})

test("server auth verification reports thrown transport failures and preserves throw semantics", () => {
  const code = source("modules/auth/server.ts")

  assert.match(code, /reportServerAuthTransportFailure/)
  assert.match(code, /if \(error \|\| !data\.user\) return null/)
  assert.doesNotMatch(code, /reportServerAuthTransportFailure\([^)]*accessToken/)
  assert.doesNotMatch(code, /console\.(?:error|warn|log)\([^\n]*accessToken/)
  assert.doesNotMatch(code, /throw transportError/, "raw auth transport errors may contain credentials and must not escape to runtime logging")
  assert.match(code, /throw createSanitizedServerAuthTransportFailure\(transportError\)/)
})

test("server auth escaping transport error is sanitized and does not retain raw cause", async () => {
  const observability = await loadServerAuthObservability()
  if (!observability) return

  const sanitize = (observability as Record<string, unknown>).createSanitizedServerAuthTransportFailure
  assert.equal(typeof sanitize, "function", "QEO-41 must sanitize the error that escapes to the runtime logger")
  if (typeof sanitize !== "function") return

  const raw = Object.assign(
    new Error("Bearer secret-access-token failed for user@example.com after timeout"),
    { name: "TimeoutError", authorization: "Bearer secret-access-token" },
  )
  const safe = (sanitize as (error: unknown) => Error & { category: string })(raw)

  assert.equal(safe.name, "ServerAuthTransportFailureError")
  assert.equal(safe.message, "Server auth transport failure (timeout)")
  assert.equal(safe.category, "timeout")
  assert.equal("cause" in safe, false)

  const serialized = `${safe.name}:${safe.message}:${JSON.stringify(safe)}`
  for (const secret of ["secret-access-token", "user@example.com", "Bearer", "authorization"]) {
    assert.equal(serialized.includes(secret), false, `sanitized runtime error leaked ${secret}`)
  }
})

test("QEO-75 market-session authenticates every privileged GET/POST request", () => {
  const code = source("supabase/functions/market-session/index.ts")
  const authGate = code.indexOf("await isMachineRequestAuthorized(")
  const postHandler = code.indexOf('if (req.method === "POST")')
  const serviceClient = code.indexOf("createClient(")
  const snapshotAccess = code.indexOf('.from("stock_orderbook_snapshots")')

  assert.ok(authGate >= 0, "market-session must have a machine authorization gate")
  assert.ok(postHandler > authGate, "authorization must cover GET as well as POST")
  assert.ok(serviceClient > authGate, "authorization must run before service-role client construction")
  assert.ok(snapshotAccess > authGate, "authorization must run before snapshot reads/writes")
  assert.match(code, /req\.method !== "GET" && req\.method !== "POST"/)
  assert.match(code, /METHOD_NOT_ALLOWED/)
})

test("QEO-75 canonical Verify scans tracked source and full Git history", () => {
  const workflow = source(".github/workflows/security.yml")
  const scanner = source("scripts/scan-secrets.sh")

  assert.match(workflow, /actions\/checkout@v6/)
  assert.match(workflow, /fetch-depth:\s*0/)
  assert.match(workflow, /gitleaks\/gitleaks-action@v3/)
  assert.match(workflow, /GITLEAKS_ENABLE_COMMENTS/)
  assert.match(workflow, /GITLEAKS_ENABLE_UPLOAD_ARTIFACT/)
  assert.match(workflow, /gitleaks detect --source \. --redact --no-banner --exit-code=2 --log-opts="--all"/)

  for (const pattern of [
    /SUPABASE_SERVICE_ROLE_KEY/,
    /UPSTASH_REDIS_REST_TOKEN/,
    /KFSP_PASSWORD/,
    /KFSP_SYNC_SECRET/,
    /MARKET_SYNC_SECRET/,
    /MARKET_CACHE_ADMIN_SECRET/,
    /AI_COUNCIL_RUN_SECRET/,
    /CRON_SECRET/,
    /QSTASH_TOKEN/,
  ]) {
    assert.match(scanner, pattern)
  }
  assert.match(scanner, /postgres(?:ql)?/i)
})

test("QEO-75 env example stays generic instead of publishing production coupling", () => {
  const example = source(".env.example")
  assert.doesNotMatch(example, /QeoIndex persistent data source: Notion only/)
  assert.doesNotMatch(example, /NOTION_[A-Z_]+_DATA_SOURCE_ID=[0-9a-f]{8}-[0-9a-f-]{27,}/i)
  assert.doesNotMatch(example, /APP_URL=https:\/\/qeoindex\.qeoqeo\.com/)
})

test("QEO-225 relay emits forensic lifecycle and publish telemetry without raw identities", () => {
  const server = source("services/market-realtime-worker/internal/relay/server.go")
  const hub = source("services/market-realtime-worker/internal/relay/hub.go")
  const protocol = source("services/market-realtime-worker/internal/relay/protocol.go")

  for (const event of [
    "relay_auth_failed",
    "relay_client_connected",
    "relay_subscription_changed",
    "relay_client_disconnected",
  ]) {
    assert.match(server, new RegExp(event))
  }
  assert.match(server, /connection_id/)
  assert.match(server, /subject_hash/)
  assert.match(server, /remote_ip_hash/)
  assert.match(server, /lifetime_ms/)
  assert.match(server, /hashIdentifier/)
  assert.doesNotMatch(server, /"subject"\s*,\s*claims\.Subject/)
  assert.doesNotMatch(server, /"remote_ip"\s*,/)
  assert.match(hub, /relay_slow_consumer/)
  assert.match(hub, /relay_publish/)
  assert.match(hub, /batch_id/)
  assert.match(hub, /queue_depth/)
  assert.match(hub, /subscribers/)
  assert.match(hub, /relayPublishSampleEvery/)
  assert.match(hub, /relaySlowPublishThreshold/)
  assert.match(protocol, /BatchID\s+string\s+`json:"batchId"`/)
})

test("QEO-225 persists sampled browser relay telemetry for post-incident correlation", () => {
  const reporterPath = "modules/market/realtime/health-reporter.ts"
  const routePath = "app/api/market/realtime-health/route.ts"
  assert.equal(existsSync(new URL(`../${reporterPath}`, import.meta.url)), true, "browser telemetry reporter must exist")
  assert.equal(existsSync(new URL(`../${routePath}`, import.meta.url)), true, "authenticated telemetry ingest route must exist")

  const relay = source("modules/market/realtime/relay-client.ts")
  const orderbook = source("modules/market/providers/dnse/orderbook-stream.ts")
  const market = source("modules/market/providers/dnse/market-stream.ts")
  const reporter = source(reporterPath)
  const route = source(routePath)

  assert.match(relay, /batchId/)
  assert.match(relay, /reportRealtimeConnectionState/)
  assert.match(orderbook, /reportRealtimeHealth/)
  assert.match(orderbook, /batchId:\s*message\.batchId/)
  assert.match(market, /reportRealtimeHealth/)
  assert.match(market, /stream:\s*"market"/)
  assert.match(market, /batchId:\s*message\.batchId/)
  assert.match(market, /delivery/)
  assert.match(reporter, /\/api\/market\/realtime-health/)
  assert.match(reporter, /keepalive:\s*true/)
  assert.match(reporter, /HEALTH_REPORT_MIN_INTERVAL_MS/)
  assert.match(reporter, /lastHealthReportAt/)
  assert.match(route, /requireApiFeature\("market_board"\)/)
  assert.match(route, /browser_relay_health/)
  assert.match(route, /browser_relay_state/)
  assert.match(route, /user_hash/)
  assert.match(route, /createHmac/)
  assert.doesNotMatch(route, /auth\.context\.user\.id[^\n]*console/)
})
