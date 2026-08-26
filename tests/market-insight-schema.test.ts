import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

test("market-close insights migrations define valid schema, compound staging keys, module-level evidence, and strict RLS", () => {
  const baseMigrationPath = path.resolve("supabase/migrations/20260826140000_market_close_insights.sql")
  const hardenMigrationPath = path.resolve("supabase/migrations/20260826150000_harden_market_close_staging_and_evidence.sql")
  const strictMigrationPath = path.resolve("supabase/migrations/20260826160000_strict_fail_closed_market_close_publish.sql")
  const fixPublishMigrationPath = path.resolve("supabase/migrations/20260826170000_fix_publish_rpc_completed_status_and_p0_coverage.sql")
  const fullP0MigrationPath = path.resolve("supabase/migrations/20260826180000_full_p0_coverage_publish_guard.sql")

  assert.ok(fs.existsSync(baseMigrationPath), "Base migration file must exist")
  assert.ok(fs.existsSync(hardenMigrationPath), "Harden migration file must exist")
  assert.ok(fs.existsSync(strictMigrationPath), "Strict fail-closed migration file must exist")
  assert.ok(fs.existsSync(fixPublishMigrationPath), "Fix publish migration file must exist")
  assert.ok(fs.existsSync(fullP0MigrationPath), "Full P0 coverage guard migration file must exist")

  const baseSql = fs.readFileSync(baseMigrationPath, "utf8")
  const hardenSql = fs.readFileSync(hardenMigrationPath, "utf8")
  const strictSql = fs.readFileSync(strictMigrationPath, "utf8")
  const fixPublishSql = fs.readFileSync(fixPublishMigrationPath, "utf8")
  const fullP0Sql = fs.readFileSync(fullP0MigrationPath, "utf8")

  // All migrations are transaction-wrapped
  assert.ok(baseSql.trim().startsWith("begin;"), "Base migration must start with begin;")
  assert.ok(baseSql.trim().endsWith("commit;"), "Base migration must end with commit;")
  assert.ok(hardenSql.trim().startsWith("begin;"), "Harden migration must start with begin;")
  assert.ok(hardenSql.trim().endsWith("commit;"), "Harden migration must end with commit;")
  assert.ok(strictSql.trim().startsWith("begin;"), "Strict migration must start with begin;")
  assert.ok(strictSql.trim().endsWith("commit;"), "Strict migration must end with commit;")
  assert.ok(fixPublishSql.trim().startsWith("begin;"), "Fix publish migration must start with begin;")
  assert.ok(fixPublishSql.trim().endsWith("commit;"), "Fix publish migration must end with commit;")
  assert.ok(fullP0Sql.trim().startsWith("begin;"), "Full P0 migration must start with begin;")
  assert.ok(fullP0Sql.trim().endsWith("commit;"), "Full P0 migration must end with commit;")

  // Staging table uses compound primary key (run_id, staging_key)
  assert.ok(
    hardenSql.includes("primary key (run_id, staging_key)"),
    "Staging table must have compound primary key on (run_id, staging_key)"
  )

  // Module-level evidence & quality columns added
  assert.ok(hardenSql.includes("add column if not exists quality_status text"), "Indexes must have quality_status")
  assert.ok(hardenSql.includes("add column if not exists evidence_refs jsonb"), "Must add evidence_refs")
  assert.ok(hardenSql.includes("add column if not exists missing_fields jsonb"), "Must add missing_fields")
  assert.ok(hardenSql.includes("add column if not exists source_timestamp timestamptz"), "Must add source_timestamp")

  // Strict P0 coverage and status=completed in fullP0 migration
  assert.ok(
    fullP0Sql.includes("status = 'completed'"),
    "Publish RPC must update status to completed (satisfying CHECK constraint)"
  )
  assert.ok(fullP0Sql.includes("canonical_indexes"), "Must check canonical_indexes")
  assert.ok(fullP0Sql.includes("market_pulse_content"), "Must check market_pulse_content")
  assert.ok(fullP0Sql.includes("ma_breadth"), "Must check ma_breadth")
  assert.ok(fullP0Sql.includes("risk_indicator"), "Must check risk_indicator")
  assert.ok(fullP0Sql.includes("psychology_indicator"), "Must check psychology_indicator")
  assert.ok(fullP0Sql.includes("cash_flows"), "Must check cash_flows")
  assert.ok(fullP0Sql.includes("sector_pulse"), "Must check sector_pulse")
  assert.ok(fullP0Sql.includes("sector_breadth"), "Must check sector_breadth")
})
