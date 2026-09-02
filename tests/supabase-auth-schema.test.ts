import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const migration = readFileSync(
  new URL("../supabase/migrations/20260821094252_user_auth_rls.sql", import.meta.url),
  "utf8",
)

const watchlistRoute = readFileSync(
  new URL("../app/api/watchlist/route.ts", import.meta.url),
  "utf8",
)

function qeo22WatchlistInvariantMigration() {
  const migrationsDir = new URL("../supabase/migrations/", import.meta.url)
  const matches = readdirSync(migrationsDir).filter((name) => name.endsWith("_qeo22_watchlist_default_invariant.sql"))
  assert.equal(matches.length, 1, "expected exactly one QEO-22 watchlist invariant migration")
  return readFileSync(new URL(`../supabase/migrations/${matches[0]}`, import.meta.url), "utf8")
}

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

test("QEO-22 enforces at most one default watchlist per user at the database boundary", () => {
  const qeo22 = qeo22WatchlistInvariantMigration()

  assert.match(qeo22, /row_number\(\) over\s*\(\s*partition by user_id/i)
  assert.match(qeo22, /order by sort_order asc, created_at asc, id asc/i)
  assert.match(qeo22, /update public\.watchlists/i)
  assert.match(qeo22, /set is_default = false/i)
  assert.match(qeo22, /create unique index if not exists watchlists_one_default_per_user/i)
  assert.match(qeo22, /on public\.watchlists\s*\(user_id\)/i)
  assert.match(qeo22, /where is_default = true/i)
})

test("QEO-22 keeps the API loser path race-safe after a unique-index conflict", () => {
  assert.match(watchlistRoute, /if \(!inserted\.error && inserted\.data\) return inserted\.data/)
  assert.match(watchlistRoute, /const fallback = await context\.supabase/)
  assert.match(watchlistRoute, /\.eq\("is_default", true\)\s*\.single\(\)/)
  assert.match(watchlistRoute, /if \(fallback\.error\) throw inserted\.error \?\? fallback\.error/)
})
