import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-107 bootstrap targets exactly the physical five-session HOT window", () => {
  const bootstrap = source("modules/market/chart-data/bootstrap.ts")
  assert.match(bootstrap, /chartHotSessionRetentionCutoff/)
  assert.match(bootstrap, /QEO107_HOT_RETENTION_SESSIONS\s*=\s*5/)
  assert.match(bootstrap, /chunks:\s*\[\{[\s\S]*class:\s*"HOT_FIRST"/)
  assert.doesNotMatch(bootstrap, /QEO107_INTRADAY_TARGET_DAYS\s*=\s*366/)
  assert.doesNotMatch(bootstrap, /COLD_BACKFILL/)
})

test("QEO-107 capacity guard is batched, conservative, and fail-closed before 400 MiB", () => {
  const steps = source("modules/market/chart-data/bootstrap-workflow-steps.ts")
  const workflow = source("workflows/chart-intraday-bootstrap.ts")
  assert.match(steps, /QEO107_CAPACITY_WARN_BYTES\s*=\s*350\s*\*\s*1024\s*\*\s*1024/)
  assert.match(steps, /QEO107_CAPACITY_HARD_STOP_BYTES\s*=\s*400\s*\*\s*1024\s*\*\s*1024/)
  assert.match(steps, /QEO107_BOOTSTRAP_BATCH_SIZE\s*=\s*10/)
  assert.match(steps, /qeo_chart_storage_capacity/)
  assert.match(steps, /projectedBatchBytes/)
  assert.match(workflow, /checkChartIntradayBootstrapCapacityStep/)
  assert.match(workflow, /QEO107_BOOTSTRAP_BATCH_SIZE/)
  assert.doesNotMatch(workflow, /for \(const chunk of context\.target\.chunks\)/)
})

test("QEO-107 provider gaps are resumable but zero-row attempts never become canonical coverage", () => {
  const provider = source("modules/market/chart-data/provider.ts")
  const hotStore = source("modules/market/chart-data/hot-store.ts")
  assert.match(provider, /export class ChartOhlcvProviderWaterfallError/)
  assert.match(provider, /terminalCoverageGap/)
  assert.match(hotStore, /if \(\(finite\(row\.row_count\) \?\? 0\) <= 0\) return null/)
  assert.match(hotStore, /readQeo107TerminalAttemptRanges/)
  assert.match(hotStore, /recordChartProviderAttempt/)
  assert.match(hotStore, /requestedTo < input\.requestedFrom/)
  assert.match(hotStore, /ensureHotIntradaySessionPartitions/)
  assert.match(hotStore, /dropEmptyHotIntradaySessionPartition/)
})

test("QEO-107 only treats a ticker as HOT-complete after five distinct trading sessions", () => {
  const bootstrap = source("modules/market/chart-data/bootstrap.ts")
  const migration = source("supabase/migrations/20260906042922_qeo107_hot_session_coverage_gate.sql")
  assert.match(bootstrap, /hotSessionCount/)
  assert.match(bootstrap, /hotSessionCount >= QEO107_HOT_RETENTION_SESSIONS/)
  assert.match(bootstrap, /outcome === "provider_gap"/)
  assert.doesNotMatch(bootstrap, /attempted\.map\(\(\{ from, to \}\)/)
  assert.match(migration, /qeo_chart_intraday_session_coverage/)
  assert.match(migration, /count\(distinct \(h\.bar_time at time zone 'Asia\/Ho_Chi_Minh'\)::date\)/i)
  assert.match(migration, /grant execute on function public\.qeo_chart_intraday_session_coverage\(text\[\], timestamptz\) to service_role/)
})

test("QEO-238 preserves QEO-107 historical bootstrap implementation while removing its active route", () => {
  const route = source("app/api/qeoindex/eod/route.ts")
  const steps = source("modules/market/chart-data/bootstrap-workflow-steps.ts")
  const workflow = source("workflows/chart-intraday-bootstrap.ts")

  assert.match(steps, /QEO107_STAGED_MAX_TICKERS\s*=\s*20/)
  assert.match(steps, /normalizeRequestedTickers/)
  assert.match(steps, /canonicalByTicker/)
  assert.match(steps, /staged ticker is outside canonical universe/)
  assert.match(workflow, /requestedTickers:\s*string\[\]\s*=\s*\[\]/)
  assert.match(workflow, /startChartIntradayBootstrapStep\(startedAtIso, requestedTickers\)/)

  assert.match(route, /RETIRED_CHART_MODES/)
  assert.match(route, /"chart-bootstrap"/)
  assert.match(route, /INTRADAY_CHART_OPERATION_RETIRED/)
  assert.match(route, /status:\s*410/)
  assert.doesNotMatch(route, /chartIntradayBootstrapWorkflow/)
  assert.doesNotMatch(route, /stagedBootstrapTickers/)
})

test("QEO-238 retires QEO-107 bootstrap and coverage operations without erasing historical schema evidence", () => {
  const route = source("app/api/qeoindex/eod/route.ts")
  const migration = source("supabase/migrations/20260905213000_qeo107_chart_intraday_coverage_report.sql")
  assert.match(route, /"chart-bootstrap"/)
  assert.match(route, /"chart-coverage"/)
  assert.match(route, /INTRADAY_CHART_OPERATION_RETIRED/)
  assert.doesNotMatch(route, /start\(chartIntradayBootstrapWorkflow/)
  assert.match(migration, /qeo_chart_intraday_coverage/)
  assert.match(migration, /grant execute on function public\.qeo_chart_intraday_coverage\(text\[\], timestamptz\) to service_role/)
})
