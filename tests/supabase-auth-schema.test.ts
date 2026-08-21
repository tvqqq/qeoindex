import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../supabase/migrations/20260821161500_user_auth_rls.sql", import.meta.url),
  "utf8",
)

test("Supabase auth migration creates per-user tables", () => {
  for (const table of ["profiles", "user_preferences", "user_features", "watchlists", "watchlist_items"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
})

test("RLS policies bind rows to auth.uid()", () => {
  assert.match(migration, /id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/)
  assert.match(migration, /create policy features_select_own/)
  assert.doesNotMatch(migration, /create policy features_(insert|update|delete)_own/)
})

test("watchlist items cannot point at another user's watchlist", () => {
  assert.match(migration, /foreign key \(watchlist_id, user_id\)/)
  assert.match(migration, /references public\.watchlists\(id, user_id\)/)
  assert.match(migration, /unique \(watchlist_id, ticker\)/)
})

test("new auth users receive profile, preferences, features and default watchlist", () => {
  assert.match(migration, /create or replace function public\.qeo_bootstrap_auth_user/)
  assert.match(migration, /after insert on auth\.users/)
  assert.match(migration, /'market_board'/)
  assert.match(migration, /'research'/)
  assert.match(migration, /'signals'/)
  assert.match(migration, /'finhay_live'/)
})
