import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

function jobBlock(catalog: string, key: string) {
  const start = catalog.indexOf(`key: "${key}"`)
  assert.ok(start >= 0, `missing admin job ${key}`)
  const next = catalog.indexOf("\nconst ", start + 1)
  return catalog.slice(start, next >= 0 ? next : undefined)
}

function functionBlock(sourceText: string, functionName: string, nextFunctionName: string) {
  const start = sourceText.indexOf(`async function ${functionName}`)
  const end = sourceText.indexOf(`async function ${nextFunctionName}`, start + 1)
  assert.ok(start >= 0 && end > start, `missing function boundary ${functionName}`)
  return sourceText.slice(start, end)
}

test("QEO-85 effective Admin catalog separates scheduled daily ownership from confirmed backfill recovery", () => {
  const catalog = source("modules/admin/effective-job-catalog.ts")
  const daily = jobBlock(catalog, "research_reports.daily")
  const backfill = jobBlock(catalog, "research_reports.backfill")

  assert.match(daily, /provider:\s*"supabase_pg_cron"/)
  assert.match(daily, /scheduleUtc:\s*"5 0 \* \* \*"/)
  assert.match(daily, /scheduleIct:\s*"07:05 hàng ngày"/)
  assert.match(daily, /schedulerName:\s*"research-reports-daily-0705-ict"/)
  assert.match(daily, /scheduleDays:\s*"daily"/)
  assert.match(daily, /evidenceSource:\s*"system_job_runs"/)
  assert.match(daily, /manualPolicy:\s*"disabled"/)

  assert.match(backfill, /provider:\s*"manual"/)
  assert.match(backfill, /manualPolicy:\s*"confirm"/)
  assert.match(backfill, /manualPurpose:\s*"recovery"/)
  assert.doesNotMatch(backfill, /scheduleUtc|schedulerName/)
})

test("QEO-85 manual capability allowlists backfill only and exposes bounded date parameters without force", () => {
  const capabilities = source("modules/admin/manual-job-capabilities.ts")
  const jobs = source("modules/admin/jobs.ts")
  const actions = source("app/admin/actions.ts")
  const api = source("app/api/admin/jobs/[key]/run/route.ts")
  const modal = source("components/admin/admin-manual-job-modal.tsx")
  const workflow = source("workflows/research-reports-backfill-workflow.ts")

  assert.match(capabilities, /"research_reports\.backfill"/)
  assert.doesNotMatch(capabilities, /"research_reports\.daily"/)

  assert.match(jobs, /fromDate\?: string/)
  assert.match(jobs, /toDate\?: string/)
  assert.match(jobs, /maxReports\?: number/)
  assert.match(jobs, /input\.key === "research_reports\.backfill"/)
  assert.match(jobs, /RESEARCH_BACKFILL_MAX_REPORTS = 100/)
  assert.match(jobs, /RESEARCH_BACKFILL_MAX_DAYS = 90/)
  const backfillDispatch = functionBlock(jobs, "runResearchReportsBackfillDispatch", "auditDispatchResult")
  assert.doesNotMatch(backfillDispatch, /force/)
  assert.match(backfillDispatch, /start\(researchReportsBackfillWorkflow/)

  assert.match(actions, /formData\.get\("fromDate"\)/)
  assert.match(actions, /formData\.get\("toDate"\)/)
  assert.match(actions, /formData\.get\("maxReports"\)/)
  assert.match(api, /fromDate\?: string/)
  assert.match(api, /toDate\?: string/)
  assert.match(api, /maxReports\?: number/)
  assert.match(modal, /job\.key === "research_reports\.backfill"/)
  assert.match(modal, /name="fromDate"/)
  assert.match(modal, /name="toDate"/)
  assert.match(modal, /name="maxReports"/)
  assert.match(modal, /max=\{100\}/)

  assert.match(workflow, /"use workflow"/)
  assert.match(workflow, /mode:\s*"backfill"/)
  assert.match(workflow, /RESEARCH_REPORTS_BACKFILL_JOB_KEY/)
  assert.match(workflow, /trigger:\s*"manual"/)
  assert.doesNotMatch(workflow, /force/)
})

test("QEO-85 scheduler reconciliation owns the exact Supabase research cron", () => {
  const scheduler = source("modules/admin/scheduler-reconciliation.ts")
  const schedulePolicy = source("modules/admin/schedule-policy.ts")
  const jobSchedule = source("modules/admin/job-schedule.ts")
  assert.match(scheduler, /jobKey:\s*"research_reports\.daily"/)
  assert.match(scheduler, /schedulerName:\s*"research-reports-daily-0705-ict"/)
  assert.match(scheduler, /schedule:\s*"5 0 \* \* \*"/)
  assert.match(schedulePolicy, /"research_reports\.daily":\s*425/)
  assert.match(jobSchedule, /"research-reports-daily-0705-ict":\s*"research_reports\.daily"/)
})

test("QEO-85 Admin AI usage reads persisted Research Reports run summary with model tokens and cost", () => {
  const workflow = source("workflows/research-reports-daily-workflow.ts")
  const health = source("modules/admin/job-health.ts")
  const table = source("components/admin/admin-jobs-table.tsx")

  assert.match(workflow, /aiModels:\s*usage\.attemptedModels/)
  assert.match(workflow, /inputTokens:\s*usage\.inputTokens/)
  assert.match(workflow, /reasoningTokens:\s*usage\.reasoningTokens/)
  assert.match(workflow, /totalTokens:\s*usage\.totalTokens/)
  assert.match(health, /researchReportsAiUsage/)
  assert.match(health, /summary\.estimatedCostUsd/)
  assert.match(table, /AI requests/)
  assert.match(table, /formatEstimatedCost\(job\.aiUsage\.estimatedCostUsd\)/)
})
