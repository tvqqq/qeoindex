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
