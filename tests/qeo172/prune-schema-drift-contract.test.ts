import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationsDir = new URL("../../supabase/migrations/", import.meta.url)

function correctiveMigration() {
  const filename = readdirSync(migrationsDir)
    .filter((name) => name.endsWith("_qeo172_restore_chart_prune_locks.sql"))
    .sort()
    .at(-1)
  assert.ok(filename, "QEO-172 corrective prune-lock migration must exist")
  return readFileSync(new URL(filename, migrationsDir), "utf8")
}

test("QEO-172 corrective prune migration restores the canonical date lifecycle lock set", () => {
  const migration = correctiveMigration()

  assert.match(migration, /v_lock_dates\s*:=\s*array\[v_candidate_date\]::date\[\]/i)
  assert.match(migration, /select value from unnest\(v_lock_dates\)[\s\S]*order by value/i)
  assert.match(migration, /qeo_chart_intraday_session_lock_key\(v_lock_date\)/i)
  assert.doesNotMatch(migration, /qeo_chart_intraday_session_lock_key\(\s*v_ticker\s*,\s*v_range_start\s*\)/i)
})

test("QEO-172 corrective prune migration preserves QEO-147 positive readiness authority", () => {
  const migration = correctiveMigration()

  assert.match(migration, /qeo_validate_chart_derived_hourly_manifests\(array\[p_manifest_id\]\)/i)
  assert.match(migration, /and\s+v\.ready/i)
  assert.match(migration, /qeo_prune_verified_chart_intraday_partition\s*\(\s*p_manifest_id uuid/i)
})

test("QEO-172 corrective migration is replay-safe before quarantined QEO-147 is activated", () => {
  const migration = correctiveMigration()

  assert.doesNotMatch(
    migration,
    /to_regprocedure\('public\.qeo_validate_chart_derived_hourly_manifests\(uuid\[\]\)'\)/i,
    "zero-to-latest replay must not require the quarantined QEO-147 validator at DDL time",
  )
  assert.match(
    migration,
    /qeo_validate_chart_derived_hourly_manifests\(array\[p_manifest_id\]\)/i,
    "prune execution must still fail closed through QEO-147 positive readiness authority",
  )
})
