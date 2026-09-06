import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

const migrationName = "20260906165000_qeo124_adjustment_factor_runs.sql"
const migrationPath = `supabase/migrations/${migrationName}`
const generatedTypesPath = "modules/shared/supabase/database.types.ts"

function migrationSql() {
  assert.equal(existsSync(migrationPath), true, `${migrationName} must exist after QEO-123 163000/164000 migrations`)
  return readFileSync(migrationPath, "utf8")
}

test("QEO-124 owns a collision-free 20260906165000 factor migration", () => {
  const versions = readdirSync("supabase/migrations")
    .filter((name) => name.startsWith("20260906165000_"))
  assert.deepEqual(versions, [migrationName])
})

test("QEO-124 stores one versioned factor run and one combined transition per effective session", () => {
  const sql = migrationSql()

  assert.match(sql, /create\s+table\s+public\.market_adjustment_factor_runs/i)
  assert.match(sql, /factor_version\s+text\s+not\s+null/i)
  assert.match(sql, /engine_version\s+text\s+not\s+null/i)
  assert.match(sql, /event_lineage_hash\s+text\s+not\s+null/i)
  assert.match(sql, /as_of_date\s+date\s+not\s+null/i)
  assert.match(sql, /status\s+text\s+not\s+null/i)
  assert.match(sql, /unique\s*\(ticker,\s*factor_version\)/i)
  assert.match(sql, /unique\s*\(id,\s*ticker\)/i)
  assert.match(sql, /where\s+status\s*=\s*'active'/i)

  assert.match(sql, /create\s+table\s+public\.market_price_adjustment_factors/i)
  assert.match(sql, /foreign\s+key\s*\(run_id,\s*ticker\)[\s\S]*?references\s+public\.market_adjustment_factor_runs\s*\(id,\s*ticker\)/i)
  assert.match(sql, /effective_session\s+date\s+not\s+null/i)
  assert.match(sql, /reference_session\s+date\s+not\s+null/i)
  assert.match(sql, /reference_raw_close\s+numeric\s+not\s+null/i)
  assert.match(sql, /step_price_factor\s+numeric\s+not\s+null/i)
  assert.match(sql, /step_volume_factor\s+numeric\s+not\s+null/i)
  assert.match(sql, /cumulative_price_factor\s+numeric\s+not\s+null/i)
  assert.match(sql, /cumulative_volume_factor\s+numeric\s+not\s+null/i)
  assert.match(sql, /corporate_action_ids\s+uuid\[\]\s+not\s+null/i)
  assert.match(sql, /formula_inputs\s+jsonb\s+not\s+null/i)
  assert.match(sql, /unique\s*\(run_id,\s*effective_session\)/i)
})

test("QEO-124 factor persistence is private, RLS-enabled, positive-only derived state", () => {
  const sql = migrationSql()

  assert.match(sql, /alter\s+table\s+public\.market_adjustment_factor_runs\s+enable\s+row\s+level\s+security/i)
  assert.match(sql, /alter\s+table\s+public\.market_price_adjustment_factors\s+enable\s+row\s+level\s+security/i)
  assert.match(sql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.market_adjustment_factor_runs\s+from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /revoke\s+all\s+privileges\s+on\s+table\s+public\.market_price_adjustment_factors\s+from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.market_adjustment_factor_runs\s+to\s+service_role/i)
  assert.match(sql, /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+public\.market_price_adjustment_factors\s+to\s+service_role/i)

  for (const column of [
    "reference_raw_close",
    "step_price_factor",
    "step_volume_factor",
    "cumulative_price_factor",
    "cumulative_volume_factor",
  ]) {
    assert.match(sql, new RegExp(`${column}\\s*>\\s*0`, "i"))
  }
})

test("QEO-124 generated Supabase types expose factor-run and transition tables", () => {
  const generated = readFileSync(generatedTypesPath, "utf8")
  assert.match(generated, /market_adjustment_factor_runs:/)
  assert.match(generated, /market_price_adjustment_factors:/)
})
