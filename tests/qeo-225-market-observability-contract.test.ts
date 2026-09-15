import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-225 market stream reports sampled browser delivery telemetry with relay correlation", () => {
  const market = source("modules/market/providers/dnse/market-stream.ts")

  assert.match(market, /reportRealtimeHealth/)
  assert.match(market, /stream:\s*"market"/)
  assert.match(market, /batchId:\s*message\.batchId/)
  assert.match(market, /delivery/)
})
