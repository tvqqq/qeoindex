import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("per-user account and watchlist APIs derive user from server auth", () => {
  for (const path of ["app/api/me/route.ts", "app/api/watchlist/route.ts"]) {
    const code = source(path)
    assert.match(code, /requireApiUser/)
    assert.match(code, /auth\.context\.user\.id/)
  }
})

test("server-rendered app surfaces verify the server session", () => {
  assert.match(source("app/page.tsx"), /getServerAuthContext/)
  assert.match(source("app/research/layout.tsx"), /getServerAuthContext/)
  assert.match(source("components/auth/app-auth-gate.tsx"), /syncServerSession/)
})

test("machine endpoints retain dedicated secret authentication", () => {
  assert.match(source("app/api/signals/daily/route.ts"), /CRON_SECRET/)
  assert.match(source("app/api/signals/monitor/route.ts"), /SIGNAL_MONITOR_SECRET/)
})
