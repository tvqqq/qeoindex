import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function workflowBody() {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const start = workflow.indexOf("export async function qeoindexEodPipeline")
  assert.ok(start >= 0, "canonical EOD workflow must exist")
  return workflow.slice(start)
}

test("QEO-58 freezes Rating before sibling TTAI/market-close refresh and joins both before READY", () => {
  const workflow = workflowBody()
  const rating = workflow.indexOf("runKfspRatingRefreshStep")
  const parallel = workflow.indexOf("Promise.all", rating)
  const ttai = workflow.indexOf("runTtaiRefreshBranch", rating)
  const market = workflow.indexOf("runMarketCloseBranch", rating)
  const ready = workflow.indexOf("runEodReadyStep", rating)
  const readyMembership = workflow.indexOf("assertReadyMatchesFrozenUniverse", ready)

  assert.ok(rating >= 0)
  assert.ok(parallel > rating, "sibling refresh join must happen after Rating freezes the universe")
  assert.ok(ttai > rating && ttai < ready, "TTAI branch must be scheduled before READY")
  assert.ok(market > rating && market < ready, "market-close branch must be scheduled before READY")
  assert.ok(ready > parallel && readyMembership > ready, "READY must join sibling refresh and validate exact membership")

  assert.match(workflow, /if \(historicalBackfill\)[\s\S]*runEodBackfillReadyStep/)
  assert.match(workflow, /Promise\.all\([\s\S]*runTtaiRefreshBranch[\s\S]*runMarketCloseBranch/)
  assert.match(workflow.slice(rating, ready), /assertFrozenUniverseStillCurrent\(ratingRefresh\.universe\)/)
  assert.match(workflow.slice(ready), /assertReadyMatchesFrozenUniverse/)
})

test("QEO-58 Rating refresh freezes an exact canonical universe for the session", () => {
  const steps = source("lib/qeoindex-eod-data-refresh-steps.ts")

  assert.match(steps, /export async function runKfspRatingRefreshStep/)
  assert.match(steps, /kfsp-rating-sync/)
  assert.match(steps, /x-kfsp-sync-secret/i)
  assert.match(steps, /ratingDate[\s\S]*sessionDate/)
  assert.match(steps, /getCanonicalUniverse\(\)/)
  assert.match(steps, /universeRunId/)
  assert.match(steps, /publishedTickers/)
  assert.match(steps, /missingRatings/)
  assert.match(steps, /unexpectedRatings/)
})

test("QEO-58 TTAI refresh is session-bound and explicit about degraded partial failures", () => {
  const steps = source("lib/qeoindex-eod-data-refresh-steps.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(steps, /export async function runTtaiRefreshStep/)
  assert.match(steps, /kfsp-ttai-history-sync/)
  assert.match(steps, /latest_rating_date/)
  assert.match(steps, /status:\s*failedTickers\.length\s*>\s*0\s*\?\s*"degraded"/)
  assert.match(steps, /failed/)
  assert.match(steps, /assertFrozenUniverseStillCurrent/)
  assert.match(workflow, /runTtaiRefreshStep\([\s\S]*ratingRefresh\.universe/)
})

test("QEO-58 READY validates frozen run identity and exact membership, not count only", () => {
  const steps = source("lib/qeoindex-eod-data-refresh-steps.ts")

  assert.match(steps, /export async function assertReadyMatchesFrozenUniverse/)
  assert.match(steps, /input\.readyUniverseRunId\s*!==\s*input\.expectedUniverse\.runId/)
  assert.match(steps, /missing=/)
  assert.match(steps, /unexpected=/)
  assert.match(steps, /input\.expectedUniverse\.tickers/)
})

test("QEO-58 exposes refresh phases without retiring morning recovery schedules", () => {
  const phases = source("lib/admin/job-phases.ts")
  const effectiveCatalog = source("lib/admin/effective-job-catalog.ts")
  const baseCatalog = source("lib/admin/catalog.ts")
  const catalog = `${baseCatalog}\n${effectiveCatalog}`

  assert.match(phases, /key: "KFSP_RATING_REFRESH"/)
  assert.match(phases, /key: "TTAI_REFRESH"/)
  assert.match(catalog, /kfsp-rating-daily-7am-ict/)
  assert.match(catalog, /kfsp-ttai-history-daily-0710-ict/)
  assert.match(effectiveCatalog, /Morning schedule.*QEO-64|morning schedule.*QEO-64/i)
})
