import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const ratingSync = readFileSync("supabase/functions/kfsp-rating-sync/index.ts", "utf8")
const ttaiSync = readFileSync("supabase/functions/kfsp-ttai-history-sync/index.ts", "utf8")
const candidateMigrationPath = "supabase/migrations/20260901221500_kfsp_canonical_rating_candidate_split.sql"

function candidateMigration() {
  assert.ok(existsSync(candidateMigrationPath), "candidate-feed split migration must exist")
  return readFileSync(candidateMigrationPath, "utf8")
}

test("KFSP rating sync separates full provider candidates from canonical stock ratings", () => {
  assert.match(ratingSync, /qeo_current_market_universe/)
  assert.match(ratingSync, /vn_top_stocks/)
  assert.match(ratingSync, /payload\?\.stocks/)
  assert.match(ratingSync, /kfsp_universe_candidate_snapshots/)
  assert.match(ratingSync, /KFSP_CANONICAL_COVERAGE_INCOMPLETE/)
  assert.match(ratingSync, /canonicalTickers/)
})

test("TTAI sync follows the current canonical RPC stocks contract", () => {
  assert.match(ttaiSync, /payload\?\.stocks/)
  assert.doesNotMatch(ttaiSync, /payload\?\.memberships/)
  assert.match(ttaiSync, /new Set\(tickers\)\.size/)
  assert.match(ttaiSync, /forceRequested \|\|/)
})

test("full KFSP candidate feed owns universe selection while remaining service-role only", () => {
  const migration = candidateMigration()
  assert.match(migration, /create table if not exists public\.kfsp_universe_candidate_snapshots/i)
  assert.match(migration, /primary key \(as_of_date, ticker\)/i)
  assert.match(migration, /volume_1d numeric/i)
  assert.match(migration, /enable row level security/i)
  assert.match(migration, /revoke all privileges[\s\S]*from anon, authenticated/i)
  assert.match(migration, /grant all privileges[\s\S]*to service_role/i)
  assert.match(migration, /create or replace function public\.qeo_select_market_universe_candidates/i)
  assert.match(migration, /from public\.kfsp_universe_candidate_snapshots/i)
  assert.doesNotMatch(migration, /from public\.insights_stock_ratings r/i)
  assert.match(migration, /activity_observation_days = 5/i)
  assert.match(migration, /activity_positive_days >= 4/i)
})
