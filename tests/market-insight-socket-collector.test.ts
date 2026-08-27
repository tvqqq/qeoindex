import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../supabase/functions/market-insight-eod-sync/index.ts", import.meta.url), "utf8")

test("market-close socket collector does not disconnect before nested sector breadth can finish", () => {
  assert.doesNotMatch(source, /setTimeout\(cleanupAndResolve,\s*3000\)/)
  assert.match(source, /const maybeResolve = \(\) =>/)
  assert.match(source, /results\.sectorBreadth = bRes\s+maybeResolve\(\)/)
  assert.match(source, /const timer = setTimeout\(cleanupAndResolve, SOCKET_TIMEOUT_MS\)/)
})

test("failed market-close validation persists endpoint coverage before returning the error", () => {
  const coverageUpdate = source.indexOf('source_observed_at: asOfIso')
  const failClosedCheck = source.indexOf('normalized.quality_status === "failing"')
  assert.ok(coverageUpdate >= 0, "sync run should persist endpoint coverage")
  assert.ok(failClosedCheck >= 0, "collector should keep the P0 fail-closed gate")
  assert.ok(coverageUpdate < failClosedCheck, "coverage diagnostics must be persisted before the fail-closed gate")
})
