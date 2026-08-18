import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("UI canonical reads use Runtime Cache then optional Upstash Redis", () => {
  const cache = source("lib/ui-data-cache.ts")
  assert.match(cache, /getCache/)
  assert.match(cache, /Redis\.fromEnv/)
  assert.match(cache, /cache\.get\(key\)/)
  assert.match(cache, /redisClient\.get/)
  assert.match(cache, /cache\.set\(key/)
  assert.match(cache, /expireTag\(tag\)/)

  const research = source("lib/research-data.ts")
  assert.match(research, /readThroughUiCache/)
  assert.match(research, /getResearchDataFresh/)
  assert.match(research, /invalidateResearchDataCache/)

  const scanner = source("lib/scanner-data.ts")
  assert.match(scanner, /readThroughUiCache/)
  assert.match(scanner, /getScannerDataFresh/)
  assert.match(scanner, /invalidateScannerDataCache/)
})

test("operational write paths bypass UI cache and invalidate after successful writes", () => {
  const promote = source("app/api/research/promote/route.ts")
  assert.match(promote, /getResearchDataFresh/)
  assert.match(promote, /getScannerDataFresh/)
  assert.match(promote, /await invalidateResearchDataCache\(\)/)

  const runner = source("lib/scanner-runner.ts")
  assert.match(runner, /getScannerDataFresh/)
  assert.match(runner, /completed\.length > 0/)
  assert.match(runner, /await invalidateScannerDataCache\(\)/)
})
