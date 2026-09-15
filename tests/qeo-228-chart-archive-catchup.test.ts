import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-228 archive catch-up fans out by ticker instead of relying on one global 48-partition EOD run", () => {
  const workflowPath = new URL("../workflows/chart-intraday-archive-catchup.ts", import.meta.url)
  const stepsPath = new URL("../modules/market/chart-data/archive-catchup-workflow-steps.ts", import.meta.url)

  assert.equal(existsSync(workflowPath), true, "dedicated catch-up workflow must exist")
  assert.equal(existsSync(stepsPath), true, "catch-up workflow steps must exist")

  const workflow = source("workflows/chart-intraday-archive-catchup.ts")
  const steps = source("modules/market/chart-data/archive-catchup-workflow-steps.ts")

  assert.match(workflow, /QEO228_ARCHIVE_BATCH_SIZE/)
  assert.match(workflow, /Promise\.all/)
  assert.match(workflow, /runChartIntradayArchiveTickerStep/)
  assert.match(steps, /getCanonicalUniverse/)
  assert.match(steps, /runChartIntradayArchiveLifecycle/)
  assert.match(steps, /ticker:\s*ticker/)
  assert.match(steps, /QEO228_MAX_PARTITIONS_PER_TICKER/)
  assert.doesNotMatch(workflow, /runChartIntradayArchiveLifecycle/)
})

test("QEO-228 catch-up remains fail-closed and reports per-ticker archive failures", () => {
  const steps = source("modules/market/chart-data/archive-catchup-workflow-steps.ts")
  const workflow = source("workflows/chart-intraday-archive-catchup.ts")

  assert.match(steps, /status:\s*"failed"/)
  assert.match(steps, /rowsPruned/)
  assert.match(steps, /partitionsDeferred/)
  assert.match(steps, /failures/)
  assert.match(workflow, /status === "failed"/)
  assert.match(workflow, /status === "partial"/)
})

test("QEO-228 exposes a machine-authenticated workflow dispatch and a post-EOD weekday schedule", () => {
  const routePath = new URL("../app/api/qeoindex/chart-archive-catchup/route.ts", import.meta.url)
  assert.equal(existsSync(routePath), true, "dedicated machine route must exist")

  const route = source("app/api/qeoindex/chart-archive-catchup/route.ts")
  const migration = source("supabase/migrations/20260915073500_qeo228_chart_archive_catchup.sql")
  const jobSchedule = source("modules/admin/job-schedule.ts")
  const effectiveCatalog = source("modules/admin/effective-job-catalog.ts")

  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /chartIntradayArchiveCatchupWorkflow/)
  assert.match(route, /qeo228-/)
  assert.match(migration, /qeoindex-chart-archive-catchup-1535-ict/)
  assert.match(migration, /35 8 \* \* 1-5/)
  assert.match(migration, /\/api\/qeoindex\/chart-archive-catchup/)
  assert.match(jobSchedule, /"qeoindex-chart-archive-catchup-1535-ict":\s*"qeoindex\.chart_archive_catchup"/)
  assert.match(jobSchedule, /"qeoindex\.chart_archive_catchup":\s*"qeoindex-chart-archive-catchup-1535-ict"/)
  assert.match(effectiveCatalog, /key:\s*"qeoindex\.chart_archive_catchup"/)
  assert.match(effectiveCatalog, /scheduleIct:\s*"15:35 T2-T6"/)
})
