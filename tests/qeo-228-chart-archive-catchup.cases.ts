import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-228 historical archive catch-up fans out by ticker instead of relying on one global 48-partition EOD run", () => {
  const workflowPath = new URL("../workflows/chart-intraday-archive-catchup.ts", import.meta.url)
  const stepsPath = new URL("../modules/market/chart-data/archive-catchup-workflow-steps.ts", import.meta.url)

  assert.equal(existsSync(workflowPath), true, "historical catch-up workflow must remain auditable")
  assert.equal(existsSync(stepsPath), true, "historical catch-up workflow steps must remain auditable")

  const workflow = source("workflows/chart-intraday-archive-catchup.ts")
  const steps = source("modules/market/chart-data/archive-catchup-workflow-steps.ts")

  assert.match(workflow, /QEO228_ARCHIVE_BATCH_SIZE/)
  assert.match(workflow, /Promise\.all/)
  assert.match(workflow, /runChartIntradayArchiveTickerStep/)
  assert.match(steps, /getCanonicalUniverse/)
  assert.match(steps, /runChartIntradayArchiveLifecycle/)
  assert.match(steps, /runChartIntradayArchiveLifecycle[\s\S]{0,220}ticker,/)
  assert.match(steps, /QEO228_MAX_PARTITIONS_PER_TICKER/)
  assert.doesNotMatch(workflow, /runChartIntradayArchiveLifecycle/)
})

test("QEO-228 historical catch-up remains fail-closed and reports per-ticker archive failures", () => {
  const steps = source("modules/market/chart-data/archive-catchup-workflow-steps.ts")
  const workflow = source("workflows/chart-intraday-archive-catchup.ts")

  assert.match(steps, /status:\s*"failed"/)
  assert.match(steps, /rowsPruned/)
  assert.match(steps, /partitionsDeferred/)
  assert.match(steps, /failures/)
  assert.match(workflow, /status === "failed"/)
  assert.match(workflow, /status === "partial"/)
})

test("QEO-238 retires QEO-228 machine dispatch and active scheduler while preserving historical evidence", () => {
  const routePath = new URL("../app/api/qeoindex/chart-archive-catchup/route.ts", import.meta.url)
  assert.equal(existsSync(routePath), true, "retired machine route must remain as a fail-closed tombstone")

  const route = source("app/api/qeoindex/chart-archive-catchup/route.ts")
  const migration = source("supabase/migrations/20260915073500_qeo228_chart_archive_catchup.sql")
  const jobSchedule = source("modules/admin/job-schedule.ts")
  const effectiveCatalog = source("modules/admin/effective-job-catalog.ts")

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /INTRADAY_CHART_OPERATION_RETIRED/)
  assert.match(route, /status:\s*410/)
  assert.doesNotMatch(route, /chartIntradayArchiveCatchupWorkflow|qeo228-/)

  assert.match(migration, /qeoindex-chart-archive-catchup-1645-ict/)
  assert.match(migration, /45 9 \* \* 1-5/)
  assert.match(migration, /\/api\/qeoindex\/chart-archive-catchup/)
  assert.match(jobSchedule, /"qeoindex-chart-archive-catchup-1645-ict":\s*"qeoindex\.chart_archive_catchup"/)
  assert.doesNotMatch(jobSchedule, /"qeoindex\.chart_archive_catchup":\s*"qeoindex-chart-archive-catchup-1645-ict"/)
  assert.match(effectiveCatalog, /key:\s*"qeoindex\.chart_archive_catchup"/)
  assert.match(effectiveCatalog, /asRetiredChartJob\(QEO228_CHART_ARCHIVE_CATCHUP_JOB\)/)
})