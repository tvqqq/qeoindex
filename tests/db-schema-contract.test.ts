import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>
}

const workflowPath = ".github/workflows/db-drift.yml"
const generatedTypesPath = "lib/supabase/database.types.ts"

function source(path: string) {
  return readFileSync(path, "utf8")
}

function qeo29RetentionMigration() {
  const matches = readdirSync("supabase/migrations").filter((name) => name.endsWith("_qeo29_job_telemetry_retention.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-29 job telemetry retention migration")
  return source(`supabase/migrations/${matches[0]}`)
}

test("QEO-23 exposes fail-closed database replay and generated type commands", () => {
  assert.equal(
    packageJson.scripts?.["db:types:generate"],
    "supabase gen types typescript --local --schema public > lib/supabase/database.types.ts",
  )
  assert.equal(packageJson.scripts?.["db:types:verify"], "node scripts/db/verify-generated-types.mjs")
  assert.equal(packageJson.scripts?.["db:replay:verify"], "bash scripts/db/verify-local-replay.sh")
})

test("QEO-23 commits the canonical generated Supabase Database contract", () => {
  assert.equal(existsSync(generatedTypesPath), true, `${generatedTypesPath} must be committed`)
  const generated = readFileSync(generatedTypesPath, "utf8")
  assert.match(generated, /export type Database\s*=\s*\{/)
  assert.match(generated, /public:\s*\{/)
})

test("DB drift workflow runs clean replay, generated type drift verification, and typecheck", () => {
  const workflow = readFileSync(workflowPath, "utf8")
  assert.match(workflow, /supabase\/setup-cli@v1/)
  assert.match(workflow, /pnpm db:replay:verify/)
  assert.match(workflow, /pnpm db:types:verify/)
  assert.match(workflow, /pnpm typecheck/)
  assert.match(workflow, /tests\/db-schema-contract\.test\.ts/)
})

test("QEO-29 keeps phase detail for 1 day and terminal run summaries for 7 days", () => {
  const sql = qeo29RetentionMigration()
  const active = source("lib/qeoindex-eod-archive.ts")

  assert.match(sql, /v_phase_cutoff\s+timestamptz\s*:=\s*p_reference_at\s*-\s*interval\s+'1 day'/i)
  assert.match(sql, /v_job_cutoff\s+timestamptz\s*:=\s*p_reference_at\s*-\s*interval\s+'7 days'/i)
  assert.match(sql, /delete\s+from\s+public\.system_job_phases[\s\S]*?status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*,\s*'skipped'\s*\)[\s\S]*?v_phase_cutoff/i)
  assert.match(sql, /delete\s+from\s+public\.system_job_runs[\s\S]*?status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*,\s*'skipped'\s*\)[\s\S]*?v_job_cutoff/i)
  assert.match(active, /rpc\("qeo_run_job_telemetry_cleanup"/)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.system_audit_log/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
})

test("QEO-30 admin job UI reads only bounded 7-day execution telemetry fields", () => {
  const code = source("lib/admin/job-health.ts")

  assert.doesNotMatch(code, /from\("system_job_runs"\)[\s\S]{0,100}select\("\*"\)/)
  assert.match(code, /SYSTEM_JOB_RUN_COLUMNS/)
  assert.match(code, /JOB_HISTORY_RETENTION_DAYS\s*=\s*7/)
  assert.match(code, /from\("system_job_runs"\)[\s\S]{0,400}\.gte\("started_at",\s*historyCutoff\)/)
})
