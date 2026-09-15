import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

test("QEO-225 relay emits forensic lifecycle and publish telemetry without raw identities", () => {
  const server = readFileSync("services/market-realtime-worker/internal/relay/server.go", "utf8")
  const hub = readFileSync("services/market-realtime-worker/internal/relay/hub.go", "utf8")
  const protocol = readFileSync("services/market-realtime-worker/internal/relay/protocol.go", "utf8")

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
  assert.match(protocol, /BatchID\s+string\s+`json:"batchId"`/)
})

test("QEO-225 persists sampled browser relay telemetry for post-incident correlation", () => {
  const reporterPath = "modules/market/realtime/health-reporter.ts"
  const routePath = "app/api/market/realtime-health/route.ts"
  assert.equal(existsSync(reporterPath), true, "browser telemetry reporter must exist")
  assert.equal(existsSync(routePath), true, "authenticated telemetry ingest route must exist")

  const relay = readFileSync("modules/market/realtime/relay-client.ts", "utf8")
  const orderbook = readFileSync("modules/market/providers/dnse/orderbook-stream.ts", "utf8")
  const reporter = readFileSync(reporterPath, "utf8")
  const route = readFileSync(routePath, "utf8")

  assert.match(relay, /batchId/)
  assert.match(relay, /reportRealtimeConnectionState/)
  assert.match(orderbook, /reportRealtimeHealth/)
  assert.match(orderbook, /batchId:\s*message\.batchId/)
  assert.match(reporter, /\/api\/market\/realtime-health/)
  assert.match(reporter, /keepalive:\s*true/)
  assert.match(route, /requireApiFeature\("market_board"\)/)
  assert.match(route, /browser_relay_health/)
  assert.match(route, /browser_relay_state/)
  assert.match(route, /user_hash/)
  assert.match(route, /createHmac/)
  assert.doesNotMatch(route, /auth\.context\.user\.id[^\n]*console/)
})
