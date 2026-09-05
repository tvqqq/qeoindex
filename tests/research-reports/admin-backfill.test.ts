import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

function jobBlock(catalog: string, key: string) {
  const start = catalog.indexOf(`key: "${key}"`)
  assert.ok(start >= 0, `missing admin job ${key}`)
  return catalog.slice(start, start + 1_200)
}

test("QEO-85 Admin catalog separates scheduled daily ownership from confirmed backfill recovery", () => {
  const catalog = source("modules/admin/catalog.ts")
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
  const modal = source("components/admin/admin-manual-job-modal.tsx")

  assert.match(capabilities, /"research_reports\.backfill"/)
  assert.doesNotMatch(capabilities, /"research_reports\.daily"/)

  assert.match(jobs, /fromDate\?: string/)
  assert.match(jobs, /toDate\?: string/)
  assert.match(jobs, /maxReports\?: number/)
  assert.match(jobs, /input\.key === "research_reports\.backfill"/)
  assert.match(jobs, /maxReports[^\n]*20|20[^\n]*maxReports/)
  assert.doesNotMatch(jobs.slice(jobs.indexOf('input.key === "research_reports.backfill"'), jobs.indexOf('input.key === "research_reports.backfill"') + 2_000), /force/)

  assert.match(actions, /formData\.get\("fromDate"\)/)
  assert.match(actions, /formData\.get\("toDate"\)/)
  assert.match(actions, /formData\.get\("maxReports"\)/)
  assert.match(modal, /job\.key === "research_reports\.backfill"/)
  assert.match(modal, /name="fromDate"/)
  assert.match(modal, /name="toDate"/)
  assert.match(modal, /name="maxReports"/)
})

test("QEO-85 scheduler reconciliation owns the exact Supabase research cron", () => {
  const scheduler = source("modules/admin/scheduler-reconciliation.ts")
  assert.match(scheduler, /jobKey:\s*"research_reports\.daily"/)
  assert.match(scheduler, /schedulerName:\s*"research-reports-daily-0705-ict"/)
  assert.match(scheduler, /schedule:\s*"5 0 \* \* \*"/)
})
