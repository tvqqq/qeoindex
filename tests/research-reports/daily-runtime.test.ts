import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-85 daily route is machine-authenticated and starts only the durable research workflow", () => {
  const route = source("app/api/research-reports/daily/route.ts")
  assert.match(route, /isMachineRequestAuthorized\(request/)
  assert.match(route, /process\.env\.CRON_SECRET/)
  assert.match(route, /start\(researchReportsDailyWorkflow/)
  assert.match(route, /workflowRunId:\s*run\.runId/)
  assert.match(route, /runtime\s*=\s*"nodejs"/)
  assert.match(route, /dynamic\s*=\s*"force-dynamic"/)
})

test("QEO-85 durable workflow persists run phases and processes compact report candidates sequentially", () => {
  const workflow = source("workflows/research-reports-daily-workflow.ts")
  assert.match(workflow, /"use workflow"/)
  assert.match(workflow, /startResearchReportsRunStep/)
  assert.match(workflow, /prepareResearchReportsRunStep/)
  assert.match(workflow, /processResearchReportRunStep/)
  assert.match(workflow, /finishResearchReportsRunStep/)
  assert.match(workflow, /for \(const candidate of prepared\.candidates\)/)
  assert.match(workflow, /budgetSnapshot/)
  assert.doesNotMatch(workflow, /ParsedReportPage|\.text\b|pdfBytes|Uint8Array/)
})

test("QEO-85 telemetry owns six aggregate phase rows plus durable report-attempt evidence", () => {
  const telemetry = source("modules/research-reports/daily/telemetry.ts")
  for (const phase of ["DISCOVER", "UPSERT_METADATA", "FETCH_PARSE", "AI_ANALYZE", "PUBLISH", "FINALIZE"]) {
    assert.match(telemetry, new RegExp(`"${phase}"`))
  }
  assert.match(telemetry, /system_job_runs/)
  assert.match(telemetry, /system_job_phases/)
  assert.match(telemetry, /market_research_report_run_items/)
  assert.match(telemetry, /estimated_cost_usd/)
  assert.match(telemetry, /pricing_version/)
  assert.match(telemetry, /unknown_usage_attempts/)
  assert.match(telemetry, /eq\("status", "running"\)/)
  assert.match(telemetry, /eq\("status", "queued"\)/)
})

test("QEO-85 runtime uses bounded daily/backfill discovery and shared retry budget", () => {
  const runtime = source("modules/research-reports/daily/runtime.ts")
  const topi = source("modules/research-reports/providers/topi.ts")
  assert.match(runtime, /DAILY_PAGE_SIZE\s*=\s*15/)
  assert.match(runtime, /DAILY_MAX_PAGES\s*=\s*8/)
  assert.match(runtime, /BACKFILL_MAX_PAGES\s*=\s*20/)
  assert.match(runtime, /DAILY_MAX_REPORTS\s*=\s*20/)
  assert.match(runtime, /BACKFILL_MAX_REPORTS\s*=\s*100/)
  assert.match(runtime, /BACKFILL_MAX_DAYS\s*=\s*90/)
  assert.match(runtime, /recentPublishDateFloor/)
  assert.match(runtime, /discoverTopiReports/)
  assert.match(runtime, /fromDate:\s*mode === "backfill"/)
  assert.match(runtime, /toDate:\s*mode === "backfill"/)
  assert.match(runtime, /slice\(0,\s*maxReports\)/)
  assert.match(runtime, /REPORT_PROCESSING_MAX_ATTEMPTS\s*=\s*3/)
  assert.match(runtime, /isRetryableResearchReportFailure/)
  assert.match(runtime, /createResearchReportAiBudget/)
  assert.match(runtime, /initialSnapshot/)
  assert.match(topi, /DEFAULT_TRANSIENT_ATTEMPTS\s*=\s*3/)
  assert.match(topi, /from_date:\s*fromDate \?\? ""/)
  assert.match(topi, /to_date:\s*toDate \?\? ""/)
})
