import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const migrationUrl = new URL(
  "../../supabase/migrations/20260907100000_qeo137_trade_lifecycle_domain.sql",
  import.meta.url,
)

function migrationSql() {
  assert.equal(
    existsSync(migrationUrl),
    true,
    "QEO-137 migration must exist before the Trade domain can ship",
  )
  return readFileSync(migrationUrl, "utf8")
}

test("QEO-137 migration exists", () => {
  assert.equal(existsSync(migrationUrl), true)
})

test("QEO-137 creates normalized Trade tables and nullable fill linkage", () => {
  const sql = migrationSql()

  assert.match(sql, /create table public\.portfolio_trades\s*\(/i)
  assert.match(sql, /create table public\.portfolio_trade_stop_events\s*\(/i)
  assert.match(sql, /create table public\.portfolio_trade_journal_entries\s*\(/i)
  assert.match(sql, /alter table public\.portfolio_transactions[\s\S]*add column trade_id uuid/i)
  assert.doesNotMatch(sql, /trade_id uuid\s+not null/i)
})

test("QEO-137 enforces relational portfolio and Trade ownership", () => {
  const sql = migrationSql()

  assert.match(sql, /unique\s*\(id,\s*user_id\)/i)
  assert.match(sql, /unique\s*\(id,\s*portfolio_id,\s*user_id,\s*ticker\)/i)
  assert.match(
    sql,
    /foreign key\s*\(portfolio_id,\s*user_id\)[\s\S]*references public\.portfolios\s*\(id,\s*user_id\)/i,
  )
  assert.match(
    sql,
    /foreign key\s*\(trade_id,\s*portfolio_id,\s*user_id,\s*ticker\)[\s\S]*references public\.portfolio_trades\s*\(id,\s*portfolio_id,\s*user_id,\s*ticker\)/i,
  )
})

test("QEO-137 encodes Trade lifecycle structure without inventing historical values", () => {
  const sql = migrationSql()

  for (const status of ["planned", "open", "partially_closed", "closed", "cancelled"]) {
    assert.match(sql, new RegExp(`'${status}'`))
  }

  assert.match(sql, /initial_stop_loss_exit numeric/i)
  assert.match(sql, /initial_account_equity numeric/i)
  assert.match(sql, /initial_risk_percent numeric/i)
  assert.match(sql, /initial_risk_amount numeric/i)
  assert.match(sql, /initial_risk_amount_per_share numeric/i)
  assert.match(sql, /planned_trade_size numeric/i)

  assert.doesNotMatch(sql, /update\s+public\.portfolio_transactions\s+set/i)
  assert.doesNotMatch(sql, /insert\s+into\s+public\.portfolio_trades\s+select/i)
})

test("QEO-137 preserves append-only stop history at authenticated API boundary", () => {
  const sql = migrationSql()

  assert.match(sql, /alter table public\.portfolio_trades enable row level security/i)
  assert.match(sql, /alter table public\.portfolio_trade_stop_events enable row level security/i)
  assert.match(sql, /alter table public\.portfolio_trade_journal_entries enable row level security/i)

  assert.match(sql, /grant select, insert on public\.portfolio_trade_stop_events to authenticated/i)
  assert.doesNotMatch(sql, /grant[^;]*(update|delete)[^;]*portfolio_trade_stop_events[^;]*authenticated/i)
  assert.match(sql, /create policy portfolio_trade_stop_events_select_own/i)
  assert.match(sql, /create policy portfolio_trade_stop_events_insert_own/i)
  assert.doesNotMatch(sql, /create policy portfolio_trade_stop_events_(update|delete)_own/i)

  const ownershipChecks = sql.match(/user_id\s*=\s*\(select auth\.uid\(\)\)/gi) ?? []
  assert.ok(ownershipChecks.length >= 8, "new mutable tables must bind CRUD policies to auth.uid()")
})

test("QEO-137 adds indexes for portfolio Trade reads and chronological event history", () => {
  const sql = migrationSql()

  assert.match(sql, /portfolio_trades_user_portfolio_status_idx/i)
  assert.match(sql, /portfolio_trades_user_portfolio_ticker_idx/i)
  assert.match(sql, /portfolio_transactions_trade_idx/i)
  assert.match(sql, /portfolio_trade_stop_events_trade_time_idx/i)
  assert.match(sql, /portfolio_trade_journal_entries_trade_time_idx/i)
})
