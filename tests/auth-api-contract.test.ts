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
  for (const path of ["app/api/me/route.ts", "app/api/watchlist/route.ts"]) {
    const code = source(path)
    assert.match(code, /requireApiUser/)
    assert.match(code, /auth\.context\.user\.id/)
  }

  const wyckoff = source("app/api/insights/wyckoff/route.ts")
  assert.match(wyckoff, /requireApiUser/)
  assert.match(wyckoff, /auth\.context\.supabase/)
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