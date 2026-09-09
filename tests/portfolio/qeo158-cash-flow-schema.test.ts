import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260909061101_qeo158_external_cash_flows.sql",
  import.meta.url,
)

test("QEO-158 adds explicit external cash-flow storage without fabricated legacy funding", () => {
  assert.ok(existsSync(migrationUrl), "QEO-158 migration SQL must exist")
  const sql = readFileSync(migrationUrl, "utf8")

  assert.match(sql, /portfolio_external_cash_flows/i)
  assert.match(sql, /funding_history_status/i)
  assert.match(sql, /legacy_unrecorded/i)
  assert.match(sql, /deposit/i)
  assert.match(sql, /withdrawal/i)
  assert.match(sql, /capital_adjustment/i)
  assert.match(sql, /signed_amount_vnd/i)
  assert.match(sql, /effective_at/i)
  assert.match(sql, /provenance/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /authenticated/i)

  assert.doesNotMatch(
    sql,
    /insert\s+into\s+(?:public\.)?portfolio_external_cash_flows/i,
    "legacy migration must never fabricate external cash-flow rows",
  )
})

test("QEO-158 legacy marking is replay-safe for post-migration portfolios", () => {
  assert.ok(existsSync(migrationUrl), "QEO-158 migration SQL must exist")
  const sql = readFileSync(migrationUrl, "utf8")

  assert.match(sql, /funding_history_status\s+is\s+null/i)
  assert.doesNotMatch(
    sql,
    /set\s+funding_history_status\s*=\s*'legacy_unrecorded'[\s\S]{0,160}funding_history_status\s*=\s*'known'/i,
    "replay must not downgrade post-migration known portfolios",
  )
})
