import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function base64urlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}

test("QEO-225 relay token route is feature-gated, POST-only, same-origin, and no-store", () => {
  const path = "app/api/market/realtime-token/route.ts"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} must exist`)
  const code = source(path)

  assert.match(code, /export async function POST/)
  assert.doesNotMatch(code, /export async function GET/)
  assert.match(code, /requireApiFeature\("market_board"\)/)
  assert.match(code, /request\.headers\.get\("origin"\)/)
  assert.match(code, /new URL\(request\.url\)\.origin/)
  assert.match(code, /QEO_MARKET_REALTIME_SIGNING_SECRET/)
  assert.match(code, /Cache-Control["']?\s*:\s*["']no-store/)
  assert.doesNotMatch(code, /DNSE_API_(?:KEY|SECRET)/)
  assert.doesNotMatch(code, /SUPABASE_SERVICE_ROLE_KEY/)
})

test("QEO-225 relay token utility emits Node-verifiable compact HMAC claims with <=60s TTL", async () => {
  const path = "modules/market/realtime/relay-token.ts"
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} must exist`)
  const module = await import(new URL(`../${path}`, import.meta.url).href)
  assert.equal(typeof module.mintMarketRealtimeToken, "function")

  const secret = "unit-test-relay-signing-secret"
  const nowMs = Date.UTC(2026, 8, 15, 5, 0, 0)
  const minted = module.mintMarketRealtimeToken("user-123", secret, nowMs)
  const parts = String(minted.token).split(".")
  assert.equal(parts.length, 2)

  const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as {
    v: number
    sub: string
    aud: string
    iat: number
    exp: number
  }
  assert.deepEqual(claims, {
    v: 1,
    sub: "user-123",
    aud: "qeo-market-realtime",
    iat: Math.floor(nowMs / 1000),
    exp: Math.floor(nowMs / 1000) + 60,
  })
  assert.ok(claims.exp - claims.iat <= 60)

  const expectedSignature = createHmac("sha256", secret).update(parts[0]).digest("base64url")
  assert.equal(parts[1], expectedSignature)
  assert.equal(String(minted.token).includes(secret), false)
  assert.equal(minted.expiresAt, new Date(claims.exp * 1000).toISOString())
})

test("QEO-225 relay token utility rejects empty identity/secret and clamps requested TTL to 60s", async () => {
  const module = await import(new URL("../modules/market/realtime/relay-token.ts", import.meta.url).href)
  const mint = module.mintMarketRealtimeToken as (
    userId: string,
    secret: string,
    nowMs?: number,
    ttlSeconds?: number,
  ) => { token: string }

  assert.throws(() => mint("", "secret"))
  assert.throws(() => mint("user", ""))

  const nowMs = Date.UTC(2026, 8, 15, 5, 0, 0)
  const { token } = mint("user-123", "secret", nowMs, 600)
  const claims = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")) as { iat: number; exp: number }
  assert.equal(claims.exp - claims.iat, 60)
})

test("QEO-225 env example declares public relay URL separately from server-only signing secret", () => {
  const env = source(".env.example")
  assert.match(env, /^NEXT_PUBLIC_QEO_MARKET_REALTIME_URL=/m)
  assert.match(env, /^QEO_MARKET_REALTIME_SIGNING_SECRET=/m)
  assert.doesNotMatch(env, /^NEXT_PUBLIC_QEO_MARKET_REALTIME_SIGNING_SECRET=/m)
})
