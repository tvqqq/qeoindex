import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

function source(path: string) {
  return readFileSync(path, "utf8")
}

test("QEO-77 orderbook-sync fails closed before privileged work", () => {
  const edge = source("supabase/functions/orderbook-sync/index.ts")

  assert.match(edge, /_shared\/machine-auth\.ts/)
  assert.match(edge, /MARKET_SYNC_SECRET/)
  assert.match(edge, /CRON_SECRET/)
  assert.match(edge, /isMachineRequestAuthorized/)
  assert.match(edge, /status:\s*401/)

  const authGate = edge.indexOf("await isMachineRequestAuthorized(")
  const serviceClient = edge.indexOf("createClient(")
  const providerFetch = edge.indexOf('fetch("https://bgapidatafeed.vps.com.vn/')
  const upsert = edge.indexOf('.from("stock_orderbook_snapshots").upsert(')

  assert.ok(authGate >= 0, "orderbook-sync must authorize every GET/POST request")
  assert.ok(serviceClient > authGate, "machine auth must run before service-role client construction")
  assert.ok(providerFetch > authGate, "machine auth must run before provider calls")
  assert.ok(upsert > authGate, "machine auth must run before database writes")
})

test("QEO-77 EOD runtime sends the dedicated market sync bearer", () => {
  const runtime = source("modules/eod/runtime-steps.ts")
  const start = runtime.indexOf("/functions/v1/orderbook-sync")
  assert.ok(start >= 0, "orderbook-sync caller must exist")

  const call = runtime.slice(Math.max(0, start - 1000), start + 1800)
  assert.match(call, /qeo_get_market_close_sync_secret/)
  assert.match(call, /Authorization:\s*`Bearer \$\{syncSecret\}`/)
})

test("QEO-77 pg_cron sends a Vault-backed bearer without plaintext secrets", () => {
  const migrationPath = "supabase/migrations/20260904111000_authenticate_orderbook_sync.sql"
  assert.equal(existsSync(migrationPath), true, "QEO-77 auth migration must exist")
  if (!existsSync(migrationPath)) return

  const sql = source(migrationPath)
  assert.match(sql, /vault\.decrypted_secrets/i)
  assert.match(sql, /kfsp_sync_secret/i)
  assert.match(sql, /Authorization/i)
  assert.match(sql, /Bearer/i)
  assert.match(sql, /orderbook-sync/i)
  assert.match(sql, /sync-universe-5m/i)
  assert.match(sql, /sync-universe-eod-1450/i)
  assert.doesNotMatch(sql, /Bearer\s+[A-Za-z0-9._-]{16,}/i)
})
