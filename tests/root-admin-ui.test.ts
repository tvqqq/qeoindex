import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import "./admin-timezone-ttai-regression.test.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("admin UI adheres strictly to UI performance invariants", () => {
  const adminFiles = [
    "components/admin/admin-header.tsx",
    "components/admin/admin-nav.tsx",
    "components/admin/admin-stat-card.tsx",
    "components/admin/admin-overview-dashboard.tsx",
    "components/admin/admin-settings-table.tsx",
    "components/admin/admin-jobs-table.tsx",
    "components/admin/admin-job-history-table.tsx",
    "components/admin/admin-job-phase-timeline.tsx",
    "components/admin/admin-manual-job-modal.tsx",
    "components/admin/admin-environment-table.tsx",
    "components/admin/admin-audit-table.tsx",
    "app/admin/layout.tsx",
    "app/admin/page.tsx",
    "app/admin/settings/page.tsx",
    "app/admin/jobs/page.tsx",
    "app/admin/jobs/[key]/page.tsx",
    "app/admin/environment/page.tsx",
    "app/admin/audit/page.tsx",
  ]

  for (const file of adminFiles) {
    const code = source(file)
    assert.doesNotMatch(code, /\btransition-all\b/, `${file} must not use transition-all`)
    assert.doesNotMatch(code, /\bbackdrop-blur\b/, `${file} must not use backdrop-blur`)
    assert.doesNotMatch(code, /\bdrop-shadow\b/, `${file} must not use drop-shadow`)
  }
})

test("admin navigation links use prefetch={false}", () => {
  const adminFiles = [
    "components/admin/admin-header.tsx",
    "components/admin/admin-nav.tsx",
    "components/admin/admin-overview-dashboard.tsx",
    "components/admin/admin-jobs-table.tsx",
    "app/admin/layout.tsx",
    "app/admin/jobs/[key]/page.tsx",
    "components/top-nav.tsx",
  ]

  for (const file of adminFiles) {
    const code = source(file)
    if (code.includes("<Link")) {
      assert.match(code, /prefetch=\{false\}/, `${file} Link components must specify prefetch={false}`)
    }
  }
})

test("admin layout strictly enforces root user authorization with a concealed 404", () => {
  const layout = source("app/admin/layout.tsx")
  assert.match(layout, /getRootPageContext/)
  assert.match(layout, /notFound\(\)/)
  assert.doesNotMatch(layout, /ROOT_ADMIN_USER_IDS/)
})

test("every data-bearing admin page guards before private loaders", () => {
  const overview = source("app/admin/page.tsx")
  const jobs = source("app/admin/jobs/page.tsx")
  const detail = source("app/admin/jobs/[key]/page.tsx")
  const settings = source("app/admin/settings/page.tsx")
  const environment = source("app/admin/environment/page.tsx")
  const audit = source("app/admin/audit/page.tsx")

  assert.match(overview, /requireRootPageContext\(\)/)
  assert.match(overview, /const actorUserId = context\.user\.id/)
  assert.doesNotMatch(overview, /actorUserId = .*root/)
  assert.ok(overview.indexOf("requireRootPageContext()") < overview.indexOf("loadAdminJobsSnapshot()"))
  assert.ok(jobs.indexOf("requireRootPageContext()") < jobs.indexOf("loadAdminJobsSnapshot()"))
  assert.ok(detail.indexOf("requireRootPageContext()") < detail.indexOf("loadAdminJobHistory("))
  assert.ok(settings.indexOf("requireRootPageContext()") < settings.indexOf("loadAdminSettingsSnapshot()"))
  assert.ok(environment.indexOf("requireRootPageContext()") < environment.indexOf("getAdminEnvironmentInventory()"))
  assert.ok(audit.indexOf("requireRootPageContext()") < audit.indexOf("loadRecentAuditLogs("))
})

test("admin job detail resolves the effective operational catalog", () => {
  const page = source("app/admin/jobs/[key]/page.tsx")
  assert.match(page, /getEffectiveAdminJobDefinition/)
  assert.doesNotMatch(page, /getAdminJobDefinition/)
})

test("admin job detail renders phase telemetry for the unified EOD pipeline", () => {
  const page = source("app/admin/jobs/[key]/page.tsx")
  assert.match(page, /AdminJobPhaseTimeline/)
  assert.match(page, /loadAdminJobPhases/)
  assert.match(page, /latestRun\?\.id/)
  assert.match(page, /QEOINDEX_EOD_JOB_KEY/)

  const timeline = source("components/admin/admin-job-phase-timeline.tsx")
  assert.match(timeline, /buildAdminJobPhaseTimeline/)
  assert.match(timeline, /phase\.key/)
  assert.match(timeline, /phase\.status/)
  assert.match(timeline, /phase\.summary/)
})

test("Admin Jobs table renders AI usage and human-readable workflow durations", () => {
  const table = source("components/admin/admin-jobs-table.tsx")
  const time = source("lib/admin/time.ts")
  assert.match(table, />AI Usage</)
  assert.match(table, /job\.aiUsage/)
  assert.match(table, /formatAdminDuration\(job\.lastDurationMs\)/)
  assert.match(table, /formatAdminTokenCount\(job\.aiUsage\.totalTokens\)/)
  assert.match(time, /export function formatAdminDuration/)
  assert.match(time, /export function formatAdminTokenCount/)
})

test("QEO-52 merges canonical KFSP scheduled history with manual system runs and dedupes IDs", async () => {
  const module = await import("../lib/admin/job-health.ts") as Record<string, unknown>
  const merge = module.mergeAdminJobHistory as ((
    systemRows: Array<Record<string, unknown>>,
    canonicalRows: Array<Record<string, unknown>>,
    limit: number,
  ) => Array<Record<string, unknown>>) | undefined

  assert.equal(typeof merge, "function")

  const rows = merge!(
    [
      {
        id: "manual-1",
        job_key: "kfsp.rating_daily",
        trigger: "manual",
        status: "succeeded",
        started_at: "2026-09-02T06:18:53.000Z",
        created_at: "2026-09-02T06:18:53.000Z",
      },
      {
        id: "same-id",
        job_key: "kfsp.rating_daily",
        trigger: "manual",
        status: "succeeded",
        started_at: "2026-09-03T00:20:00.000Z",
        created_at: "2026-09-03T00:20:00.000Z",
      },
    ],
    [
      {
        id: "scheduled-1",
        job_key: "kfsp.rating_daily",
        trigger: "cron",
        status: "succeeded",
        started_at: "2026-09-03T00:00:02.000Z",
      },
      {
        id: "same-id",
        job_key: "kfsp.rating_daily",
        trigger: "cron",
        status: "succeeded",
        started_at: "2026-09-03T00:20:00.000Z",
      },
    ],
    50,
  )

  assert.deepEqual(rows.map((row) => row.id), ["same-id", "scheduled-1", "manual-1"])
  assert.equal(rows[0].trigger, "manual", "system_job_runs metadata must win on duplicate IDs")
})

test("QEO-52 job detail uses canonical evidence and labels active workflow progress honestly", () => {
  const page = source("app/admin/jobs/[key]/page.tsx")
  const catalog = source("lib/admin/effective-job-catalog.ts")

  assert.match(page, /loadAdminJobView/)
  assert.doesNotMatch(page, /buildAdminJobViews\(\[jobDefinition\], history\)/)
  assert.match(page, /currentSummary/)
  assert.match(page, /Current stage/)
  assert.match(page, /Next wake/)
  assert.match(page, /Last completed quality/)
  assert.match(catalog, /07:00–07:59/)
})
