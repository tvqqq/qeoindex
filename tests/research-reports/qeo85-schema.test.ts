import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

function researchMigration() {
  const directories = ["supabase/pending-migrations", "supabase/migrations"].filter(existsSync)
  const matches = directories.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith("_qeo80_research_reports.sql"))
      .map((name) => `${directory}/${name}`),
  )
  assert.equal(matches.length, 1, "expected exactly one QEO-80/QEO-85 research migration")
  assert.match(matches[0], /^supabase\/pending-migrations\//, "research schema must remain quarantined until rollout")
  return readFileSync(matches[0], "utf8")
}

test("QEO-85 quarantined schema adds cache-write usage, analysis leases, and run-item evidence", () => {
  const sql = researchMigration()

  assert.match(sql, /cache_write_tokens\s+bigint\s+not\s+null\s+default\s+0/i)
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.market_research_report_analysis_leases/i)
  assert.match(sql, /unique\s*\(report_id,\s*content_hash,\s*analysis_version,\s*prompt_version,\s*model_route_key\)/i)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_acquire_research_report_analysis_lease\s*\(/i)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_release_research_report_analysis_lease\s*\(/i)
  assert.match(sql, /create\s+table\s+if\s+not\s+exists\s+public\.market_research_report_run_items/i)
  assert.match(sql, /unique\s*\(run_id,\s*report_id\)/i)
  assert.match(sql, /market_research_report_run_items[\s\S]*?service_role/i)
  assert.match(sql, /market_research_report_analysis_leases[\s\S]*?service_role/i)
})

test("QEO-85 rollout-coupled scheduler is exact 07:05 ICT daily and Vault-authenticated", () => {
  const sql = researchMigration()

  assert.match(sql, /qeo_trigger_research_reports_daily/i)
  assert.match(sql, /research-reports-daily-0705-ict/i)
  assert.match(sql, /'5 0 \* \* \*'/)
  assert.match(sql, /qeoindex_app_url/i)
  assert.match(sql, /qeoindex_cron_secret/i)
  assert.match(sql, /\/api\/research-reports\/daily/i)
  assert.match(sql, /authorization/i)
  assert.doesNotMatch(sql, /vercel\.json/i)
})
