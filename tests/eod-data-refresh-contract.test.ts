import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { EFFECTIVE_ADMIN_JOB_CATALOG } from "../lib/admin/effective-job-catalog.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function workflowBody() {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  const start = workflow.indexOf("export async function qeoindexEodPipeline")
  assert.ok(start >= 0, "canonical EOD workflow must exist")
  return workflow.slice(start)
}

test("Rating freezes before sibling TTAI/market-close refresh and both join before READY", () => {
  const workflow = workflowBody()
  const rating = workflow.indexOf("runKfspRatingRefreshStep")
  const parallel = workflow.indexOf("Promise.all", rating)
  const ttai = workflow.indexOf("runTtaiRefreshBranch", rating)
  const market = workflow.indexOf("runMarketCloseBranch", rating)
  const ready = workflow.indexOf("runEodReadyStep", rating)
  const readyMembership = workflow.indexOf("assertReadyMatchesFrozenUniverse", ready)

  assert.ok(rating >= 0)
  assert.ok(parallel > rating)
  assert.ok(ttai > rating && ttai < ready)
  assert.ok(market > rating && market < ready)
  assert.ok(ready > parallel && readyMembership > ready)
  assert.match(workflow, /if \(historicalBackfill\)[\s\S]*runEodBackfillReadyStep/)
  assert.match(workflow, /Promise\.all\([\s\S]*runTtaiRefreshBranch[\s\S]*runMarketCloseBranch/)
  assert.match(workflow.slice(rating, ready), /assertFrozenUniverseStillCurrent\(ratingRefresh\.universe\)/)
  assert.match(workflow.slice(ready), /assertReadyMatchesFrozenUniverse/)
})

test("Rating refresh freezes an exact canonical universe for the session", () => {
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

test("TTAI refresh is session-bound and explicit about degraded partial failures", () => {
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

test("READY validates frozen run identity and exact membership, not count only", () => {
  const steps = source("lib/qeoindex-eod-data-refresh-steps.ts")
  const delegated = source("lib/qeoindex-eod-workflow-steps.ts")
  const legacyDelegated = source("lib/qeoindex-eod-workflow-steps-legacy.ts")

  assert.match(steps, /export async function assertReadyMatchesFrozenUniverse/)
  assert.match(steps, /input\.readyUniverseRunId\s*!==\s*input\.expectedUniverse\.runId/)
  assert.match(steps, /missing=/)
  assert.match(steps, /unexpected=/)
  assert.match(steps, /input\.expectedUniverse\.tickers/)
  assert.match(delegated, /runEodReadyStep/)
  assert.match(legacyDelegated, /getCanonicalUniverse/)
  assert.match(legacyDelegated, /loadWyckoffV2Universe/)
  assert.doesNotMatch(legacyDelegated, /beginWyckoffV2NotionRun|claimReadyWyckoffV2Run|publishIngestingWyckoffV2Run/)
})

test("READY retries bounded known not-ready states even when wrapper error codes are lost", () => {
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")
  assert.match(workflow, /EOD_READY_MAX_ATTEMPTS = 4/)
  assert.match(workflow, /EOD_READY_RETRY_INTERVAL_MS = 5 \* 60_000/)
  assert.match(workflow, /function isEodNotReady/)
  assert.match(workflow, /EOD_NOT_READY/)
  assert.match(workflow, /FINAL EOD MARKET SNAPSHOTS INCOMPLETE/)
  assert.match(workflow, /CANONICAL RATING UNIVERSE INCOMPLETE/)
  assert.match(workflow, /KFSP\/TTAI RATING DATE/)
})

test("morning freshness schedulers are retired while explicit recovery capability remains", () => {
  const phases = source("lib/admin/job-phases.ts")
  const baseCatalog = source("lib/admin/catalog.ts")
  assert.match(phases, /key: "KFSP_RATING_REFRESH"/)
  assert.match(phases, /key: "TTAI_REFRESH"/)
  assert.match(baseCatalog, /kfsp-rating-daily-7am-ict/)
  assert.match(baseCatalog, /kfsp-ttai-history-daily-0710-ict/)

  for (const key of ["kfsp.rating_daily", "kfsp.ttai_history"]) {
    const job = EFFECTIVE_ADMIN_JOB_CATALOG.find((candidate) => candidate.key === key)
    assert.ok(job)
    assert.equal(job.scheduleKind, "manual")
    assert.equal(job.scheduleUtc, undefined)
    assert.equal(job.schedulerName, undefined)
    assert.equal(job.manualPolicy, "confirm")
    assert.equal(job.manualPurpose, "recovery")
    assert.deepEqual(job.automatedParentKeys, ["qeoindex.eod_pipeline"])
  }
})
