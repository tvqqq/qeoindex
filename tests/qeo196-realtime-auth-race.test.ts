import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("QEO-196 waits for browser auth before realtime bus bootstrap and CDC join", () => {
  const source = readFileSync("modules/market/providers/dnse/market-stream.ts", "utf8")
  const start = source.indexOf("async function startSupabaseRealtime")
  assert.notEqual(start, -1, "market stream must have an auth-gated async startup path")

  const body = source.slice(start, source.indexOf("export function publishDnseMarketFrame"))
  const authIndex = body.indexOf("await supabase.auth.getSession()")
  const setAuthIndex = body.indexOf("await supabase.realtime.setAuth(session.access_token)")
  const bootstrapIndex = body.indexOf("await bootstrapCurrentRow(supabase)")
  const channelIndex = body.indexOf(".channel(CHANNEL_NAME)")

  assert.ok(authIndex >= 0, "startup must hydrate the browser Supabase session")
  assert.ok(setAuthIndex > authIndex, "Realtime must receive the authenticated access token")
  assert.ok(bootstrapIndex > setAuthIndex, "authenticated bootstrap must happen after Realtime auth")
  assert.ok(channelIndex > bootstrapIndex, "CDC subscription must happen only after authenticated bootstrap")
})
