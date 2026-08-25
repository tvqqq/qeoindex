import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const sql = readFileSync(new URL("../supabase/migrations/20260823143000_wyckoff_unified_data.sql", import.meta.url), "utf8")
const v2Url = new URL("../supabase/migrations/20260825170000_wyckoff_contract_v2.sql", import.meta.url)

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

test("Wyckoff v2 migration makes rank anomalies warning-only, versions operational identity and represents genuine Incomplete", () => {
  assert.equal(existsSync(v2Url), true, "wyckoff_contract_v2 migration must exist")
  if (!existsSync(v2Url)) return
  const v2 = readFileSync(v2Url, "utf8")

  assert.match(v2, /drop constraint if exists wyckoff_universe_memberships_universe_key_rank_effective_date_key/i)
  assert.match(v2, /drop constraint if exists wyckoff_universe_memberships_rank_check/i)
  assert.match(v2, /alter column rank drop not null/i)

  assert.match(v2, /wyckoff_scan_runs[\s\S]*add column if not exists prompt_version text not null default 'notion-unified-v1'/i)
  assert.match(v2, /wyckoff_analysis_snapshots[\s\S]*add column if not exists prompt_version text not null default 'notion-unified-v1'/i)
  assert.match(v2, /unique \(ticker, timeframe, bar_closed_at, model_version, aggregation_version, prompt_version\)/i)

  for (const column of [
    "phase",
    "wyckoff_state",
    "ta_bias",
    "confidence",
    "bull_probability",
    "base_probability",
    "bear_probability",
    "support",
    "resistance",
    "confirmation",
    "invalidation",
    "what_changed",
  ]) {
    assert.match(v2, new RegExp(`alter column ${column} drop not null`, "i"), `${column} must be nullable for genuine Incomplete rows`)
  }

  assert.match(v2, /prompt_version <> 'notion-unified-v2'[\s\S]*history_status <> 'complete'[\s\S]*history_bar_count >= 60[\s\S]*bull_probability \+ base_probability \+ bear_probability = 100/i)
  assert.match(v2, /prompt_version <> 'notion-unified-v2'[\s\S]*history_status <> 'incomplete'[\s\S]*history_bar_count < 60[\s\S]*bull_probability is null[\s\S]*base_probability is null[\s\S]*bear_probability is null/i)
  assert.match(v2, /jsonb_array_length\(scenarios\) = 0/i)
  assert.match(v2, /evidence->>'missingReason'/i)
})
