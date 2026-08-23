import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const sql = readFileSync(new URL("../supabase/migrations/20260823143000_wyckoff_unified_data.sql", import.meta.url), "utf8")

test("Wyckoff unified migration creates versioned read and history tables", () => {
  for (const table of ["wyckoff_universe_memberships", "wyckoff_scan_runs", "wyckoff_analysis_snapshots", "wyckoff_chart_series"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(sql, /bull_probability \+ base_probability \+ bear_probability = 100/)
  assert.match(sql, /unique \(ticker, timeframe, bar_closed_at, model_version, aggregation_version\)/)
  assert.match(sql, /jsonb_array_length\(bars\) <= 260/)
  assert.match(sql, /with \(security_invoker = true\)/)
  assert.doesNotMatch(sql, /grant (insert|update|delete|all).*authenticated/i)
})
