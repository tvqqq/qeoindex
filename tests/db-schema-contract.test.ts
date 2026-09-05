import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import "./research-reports/domain.test.ts"

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>
}

const workflowPath = ".github/workflows/db-drift.yml"
const generatedTypesPath = "modules/shared/supabase/database.types.ts"

function source(path: string) {
  return readFileSync(path, "utf8")
}

function qeo29RetentionMigration() {
  const matches = readdirSync("supabase/migrations").filter((name) => name.endsWith("_qeo29_job_telemetry_retention.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-29 job telemetry retention migration")
  return source(`supabase/migrations/${matches[0]}`)
}

function qeo39NPlusOneMigration() {
  const matches = readdirSync("supabase/migrations").filter((name) => name.endsWith("_qeo39_wyckoff_n_plus_one.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-39 N+1 migration")
  return source(`supabase/migrations/${matches[0]}`)
}

function qeo39GroupedRpcMigration() {
  const matches = readdirSync("supabase/migrations").filter((name) => name.endsWith("_qeo39_grouped_ohlcv_rpc.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-39 grouped OHLCV migration")
  return source(`supabase/migrations/${matches[0]}`)
}

test("QEO-23 exposes fail-closed database replay and generated type commands", () => {
  assert.equal(
    packageJson.scripts?.["db:types:generate"],
    "supabase gen types typescript --local --schema public > modules/shared/supabase/database.types.ts",
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

test("DB drift workflow runs clean replay, generated type drift verification, current DB suite, and typecheck", () => {
  const workflow = readFileSync(workflowPath, "utf8")
  assert.match(workflow, /supabase\/setup-cli@v1/)
  assert.match(workflow, /pnpm db:replay:verify/)
  assert.match(workflow, /pnpm db:types:verify/)
  assert.match(workflow, /pnpm test:db/)
  assert.match(workflow, /pnpm typecheck/)
  assert.doesNotMatch(workflow, /node --test[^\n]*tests\/db-schema-contract\.test\.ts/)
})

test("QEO-29 keeps phase detail for 1 day and terminal run summaries for 7 days", () => {
  const sql = qeo29RetentionMigration()
  const active = source("modules/eod/archive.ts")

  assert.match(sql, /v_phase_cutoff\s+timestamptz\s*:=\s*p_reference_at\s*-\s*interval\s+'1 day'/i)
  assert.match(sql, /v_job_cutoff\s+timestamptz\s*:=\s*p_reference_at\s*-\s*interval\s+'7 days'/i)
  assert.match(sql, /delete\s+from\s+public\.system_job_phases[\s\S]*?status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*,\s*'skipped'\s*\)[\s\S]*?v_phase_cutoff/i)
  assert.match(sql, /delete\s+from\s+public\.system_job_runs[\s\S]*?status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*,\s*'skipped'\s*\)[\s\S]*?v_job_cutoff/i)
  assert.match(active, /rpc\("qeo_run_job_telemetry_cleanup"/)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.system_audit_log/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
})

test("QEO-30 admin job UI reads only bounded 7-day execution telemetry fields", () => {
  const code = source("modules/admin/job-health.ts")

  assert.doesNotMatch(code, /from\("system_job_runs"\)[\s\S]{0,100}select\("\*"\)/)
  assert.match(code, /SYSTEM_JOB_RUN_COLUMNS/)
  assert.match(code, /JOB_HISTORY_RETENTION_DAYS\s*=\s*7/)
  assert.match(code, /from\("system_job_runs"\)[\s\S]{0,400}\.gte\("started_at",\s*historyCutoff\)/)
})

test("QEO-39 batches recent OHLCV through indexed per-ticker lateral lookups", () => {
  const sql = qeo39NPlusOneMigration()

  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_market_ohlcv_recent\s*\(p_tickers\s+text\[\],\s*p_limit\s+integer\s+default\s+260\)/i)
  assert.match(sql, /unnest\s*\(p_tickers\)/i)
  assert.match(sql, /cross\s+join\s+lateral/i)
  assert.match(sql, /source\.ticker\s*=\s*q\.ticker/i)
  assert.match(sql, /order\s+by\s+source\.bar_time\s+desc/i)
  assert.match(sql, /least\s*\(\s*coalesce\s*\(p_limit,\s*260\),\s*1700\s*\)/i)
  assert.doesNotMatch(sql, /row_number\s*\(/i)
})

test("QEO-39 grouped RPC keeps PostgREST result rows bounded without reducing per-ticker history", () => {
  const sql = qeo39GroupedRpcMigration()

  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_market_ohlcv_recent_grouped/i)
  assert.match(sql, /returns\s+table\s*\([\s\S]*?ticker\s+text\s*,[\s\S]*?rows\s+jsonb/i)
  assert.match(sql, /jsonb_agg\s*\(/i)
  assert.match(sql, /left\s+join\s+lateral/i)
  assert.match(sql, /source\.ticker\s*=\s*q\.ticker/i)
  assert.match(sql, /least\s*\(\s*coalesce\s*\(p_limit,\s*260\),\s*1700\s*\)/i)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.qeo_market_ohlcv_recent_grouped[\s\S]*?anon,\s*authenticated/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.qeo_market_ohlcv_recent_grouped[\s\S]*?service_role/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
})

test("QEO-39 stores large build payloads in private run-scoped artifacts with terminal one-day cleanup", () => {
  const sql = qeo39NPlusOneMigration()
  const active = source("modules/eod/archive.ts")

  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.wyckoff_build_artifacts/i)
  assert.match(sql, /primary\s+key\s*\(run_id,\s*ticker\)/i)
  assert.match(sql, /references\s+public\.system_job_runs\s*\(id\)\s+on\s+delete\s+cascade/i)
  assert.match(sql, /jsonb_array_length\s*\(snapshots\)\s*=\s*2/i)
  assert.match(sql, /enable\s+row\s+level\s+security/i)
  assert.match(sql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.wyckoff_build_artifacts\s+from\s+anon,\s*authenticated/i)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_run_wyckoff_build_artifact_cleanup/i)
  assert.match(sql, /status\s+in\s*\(\s*'succeeded'\s*,\s*'failed'\s*,\s*'skipped'\s*\)/i)
  assert.match(sql, /p_reference_at\s*-\s*interval\s+'1 day'/i)
  assert.match(active, /rpc\("qeo_run_wyckoff_build_artifact_cleanup"/)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
})
