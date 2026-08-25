import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("effective Admin Jobs catalog exposes one 15:15 QeoIndex EOD pipeline", () => {
  const catalog = source("lib/admin/effective-job-catalog.ts")
  assert.match(catalog, /qeoindex\.eod_pipeline/)
  assert.match(catalog, /15 8 \* \* 1-5/)
  assert.match(catalog, /15:15 T2-T6/)
  assert.match(catalog, /supabase_pg_cron_workflow/)
  assert.doesNotMatch(catalog, /key:\s*"ai_council\.eod"/)
})

test("phase model projects canonical dependency order and pending phases", async () => {
  let phaseModule: typeof import("../lib/admin/job-phases.ts") | null = null
  try {
    phaseModule = await import("../lib/admin/job-phases.ts")
  } catch {
    phaseModule = null
  }

  assert.ok(phaseModule, "lib/admin/job-phases.ts must exist")
  const timeline = phaseModule.buildAdminJobPhaseTimeline([
    {
      id: "phase-1",
      run_id: "run-1",
      job_key: "qeoindex.eod_pipeline",
      phase_key: "EOD_READY",
      phase_order: 1,
      status: "succeeded",
      started_at: "2026-08-25T08:15:00.000Z",
      finished_at: "2026-08-25T08:15:12.000Z",
      duration_ms: 12_000,
      summary: { sessionDate: "2026-08-25" },
      error_code: null,
      error_message: null,
    },
  ])

  assert.deepEqual(timeline.map((phase) => phase.key), [
    "EOD_READY",
    "HISTORY_REFRESH",
    "WYCKOFF_BUILD",
    "NOTION_STAGING",
    "NOTION_VALIDATE",
    "INGEST",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "AI_COUNCIL_LLM",
    "COMPLETE",
  ])
  assert.equal(timeline[0].status, "succeeded")
  assert.equal(timeline[1].status, "pending")
  assert.deepEqual(timeline[0].summary, { sessionDate: "2026-08-25" })
})

test("control plane has private service-role phase telemetry storage", () => {
  const migrationPath = new URL("../supabase/migrations/20260825160000_system_job_phases.sql", import.meta.url)
  assert.equal(existsSync(migrationPath), true, "system_job_phases migration must exist")
  const sql = readFileSync(migrationPath, "utf8")

  assert.match(sql, /create table if not exists public\.system_job_phases/)
  assert.match(sql, /references public\.system_job_runs\(id\) on delete cascade/)
  assert.match(sql, /unique \(run_id, phase_key\)/)
  assert.match(sql, /alter table public\.system_job_phases enable row level security/)
  assert.match(sql, /revoke all privileges on table public\.system_job_phases from anon, authenticated/)
  assert.match(sql, /grant all privileges on table public\.system_job_phases to service_role/)
})
