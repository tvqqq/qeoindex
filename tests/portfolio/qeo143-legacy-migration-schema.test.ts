import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260909044821_qeo143_legacy_portfolio_migration.sql",
  import.meta.url,
)

test("QEO-143 migration exposes explicit legacy provenance without fabricating history", () => {
  assert.ok(existsSync(migrationUrl), "QEO-143 legacy migration SQL must exist")
  const sql = readFileSync(migrationUrl, "utf8")

  assert.match(sql, /record_origin/i)
  assert.match(sql, /legacy_migration_status/i)
  assert.match(sql, /origin/i)
  assert.match(sql, /grouping_status/i)
  assert.match(sql, /scorecard_eligible/i)
  assert.match(sql, /legacy_opened_on/i)
  assert.match(sql, /legacy_closed_on/i)
  assert.match(sql, /legacy_source_transaction_count/i)
  assert.match(sql, /mode\s+in\s*\(\s*'live'\s*,\s*'paper'\s*,\s*'unknown'\s*\)/i)
  assert.match(sql, /qeo143_backfill_legacy_portfolio_trades/i)
  assert.match(sql, /qeo143_legacy_migration_audit/i)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.qeo143_backfill_legacy_portfolio_trades/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.qeo143_backfill_legacy_portfolio_trades/i)

  assert.doesNotMatch(sql, /initial_stop_loss_exit\s*=\s*.*stop_loss_/i)
  assert.doesNotMatch(sql, /opened_at\s*=\s*.*created_at/i)
  assert.doesNotMatch(sql, /closed_at\s*=\s*.*created_at/i)
})

test("QEO-143 migration keeps deterministic backfill service-role only and auditable", () => {
  assert.ok(existsSync(migrationUrl), "QEO-143 legacy migration SQL must exist")
  const sql = readFileSync(migrationUrl, "utf8")

  assert.match(sql, /legacy_ungrouped/i)
  assert.match(sql, /deterministic_grouped/i)
  assert.match(sql, /legacy_migration/i)
  assert.match(sql, /deterministic/i)
  assert.match(sql, /unknown/i)
  assert.match(sql, /service_role/i)
  assert.match(sql, /rows_scanned/i)
  assert.match(sql, /rows_grouped/i)
  assert.match(sql, /trades_created/i)
  assert.match(sql, /rows_unresolved/i)
})
