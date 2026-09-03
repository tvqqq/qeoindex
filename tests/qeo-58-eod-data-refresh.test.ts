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

test("QEO-58 refreshes same-session KFSP/TTAI and market close before READY", () => {
  const workflow = workflowBody()
  const ordered = [
    "runKfspRatingRefreshStep",
    "runTtaiRefreshStep",
    "runMarketCloseCollectStep",
    "runEodReadyStep",
  ]

  let cursor = -1
  for (const call of ordered) {
    const next = workflow.indexOf(call, cursor + 1)
    assert.ok(next > cursor, `${call} must run after the prior same-session refresh stage`)
    cursor = next
  }

  assert.match(workflow, /if \(historicalBackfill\)[\s\S]*runEodBackfillReadyStep/)
  assert.match(workflow, /runTtaiRefreshStep\([\s\S]*ratingRefresh\.universe/)
  assert.match(workflow, /runMarketCloseCollectStep\([\s\S]*ratingRefresh\.universe\.runId/)
  assert.match(workflow, /runEodReadyStep\([\s\S]*ratingRefresh\.universe/)
})

test("QEO-58 Rating refresh freezes an exact canonical universe for the session", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")

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
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")

  assert.match(steps, /export async function runTtaiRefreshStep/)
  assert.match(steps, /kfsp-ttai-history-sync/)
  assert.match(steps, /latest_rating_date/)
  assert.match(steps, /status:\s*"degraded"/)
  assert.match(steps, /failed/)
  assert.match(steps, /assertFrozenUniverseStillCurrent/)
})

test("QEO-58 READY validates frozen run identity and exact membership, not count only", () => {
  const legacy = source("lib/qeoindex-eod-workflow-steps-legacy.ts")

  assert.match(legacy, /expectedUniverse/)
  assert.match(legacy, /universe\.runId\s*!==\s*expectedUniverse\.runId/)
  assert.match(legacy, /missing=/)
  assert.match(legacy, /unexpected=/)
  assert.doesNotMatch(legacy, /selection\.stocks\.length\s*!==\s*market\.ratingTickers\.length[\s\S]*return \{/)
})

test("QEO-58 exposes refresh phases without retiring morning recovery schedules", () => {
  const phases = source("lib/admin/job-phases.ts")
  const catalog = source("lib/admin/effective-job-catalog.ts")

  assert.match(phases, /key: "KFSP_RATING_REFRESH"/)
  assert.match(phases, /key: "TTAI_REFRESH"/)
  assert.match(catalog, /kfsp-rating-daily-7am-ict/)
  assert.match(catalog, /kfsp-ttai-history-daily-0710-ict/)
})
