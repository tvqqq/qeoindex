import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const retryUrl = new URL("../lib/qeoindex-market-close-retry.ts", import.meta.url)

test("market-close readiness retries at 15:20 and 15:25 before failing closed", () => {
  assert.equal(existsSync(retryUrl), true, "market-close retry policy helper must exist")
  if (!existsSync(retryUrl)) return

  const policy = source("lib/qeoindex-market-close-retry.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(policy, /MARKET_CLOSE_MAX_ATTEMPTS\s*=\s*3/)
  assert.match(policy, /MARKET_CLOSE_RETRY_INTERVAL_MS\s*=\s*5\s*\*\s*60_000/)
  assert.match(workflow, /attempt\s*<=\s*MARKET_CLOSE_MAX_ATTEMPTS/)
  assert.match(workflow, /sleep\(marketCloseRetryAt\(startedAtIso, attempt\)\)/)
  assert.match(workflow, /attempt === MARKET_CLOSE_MAX_ATTEMPTS[\s\S]*throw error/)
})

test("market-close retry policy distinguishes transient provider failures from permanent auth/config failures", () => {
  assert.equal(existsSync(retryUrl), true, "market-close retry policy helper must exist")
  if (!existsSync(retryUrl)) return

  const policy = source("lib/qeoindex-market-close-retry.ts")
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")

  assert.match(policy, /408/)
  assert.match(policy, /429/)
  assert.match(policy, />=\s*500/)
  assert.match(policy, /VALIDATION_FAILED/)
  assert.match(policy, /P0_INCOMPLETE/)
  assert.match(steps, /MARKET_CLOSE_COLLECT_TRANSIENT/)
  assert.match(steps, /MARKET_CLOSE_COLLECT_FAILED/)
  assert.match(steps, /qeo_get_market_close_sync_secret[\s\S]*MARKET_CLOSE_COLLECT_FAILED/)
})

test("market-close phase exposes attemptsUsed and returns to running while waiting for a retry", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")

  assert.match(steps, /attemptsUsed/)
  assert.match(steps, /markMarketCloseRetryingStep/)
  assert.match(steps, /status:\s*"running"/)
  assert.match(workflow, /markMarketCloseRetryingStep\(runId, attempt/)
  assert.match(workflow, /marketCloseRetryAt\(startedAtIso, attempt\)/)
})
