import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 publishes one derived generation atomically under the manifest lock", () => {
  const migrationUrl = new URL(
    "../../supabase/migrations/20260911162000_qeo172_atomic_derived_generation_publish.sql",
    import.meta.url,
  )
  assert.equal(existsSync(migrationUrl), true, "active atomic derived-generation migration must exist")

  const migration = readFileSync(migrationUrl, "utf8")
  const store = source("modules/market/chart-data/derived-hourly-store.ts")

  assert.match(migration, /qeo_publish_chart_derived_hourly_generation/)
  assert.match(migration, /pg_advisory_xact_lock\(public\.qeo_chart_derived_hourly_manifest_lock_key\(p_manifest_id\)\)/)
  assert.match(migration, /delete\s+from\s+public\.chart_ohlcv_derived_hourly/i)
  assert.match(migration, /insert\s+into\s+public\.chart_ohlcv_derived_hourly/i)
  assert.match(migration, /insert\s+into\s+public\.chart_ohlcv_derived_hourly_readiness/i)
  assert.match(migration, /qeo_validate_chart_derived_hourly_manifests/)

  const persistStart = store.indexOf("export async function persistVerifiedDerivedHourlyGeneration")
  assert.notEqual(persistStart, -1)
  const persist = store.slice(persistStart)
  assert.match(persist, /qeo_publish_chart_derived_hourly_generation/)
  assert.doesNotMatch(persist, /await upsertDerivedHourlyBars/)
  assert.doesNotMatch(persist, /readDerivedHourlyGenerationByManifest/)
})
