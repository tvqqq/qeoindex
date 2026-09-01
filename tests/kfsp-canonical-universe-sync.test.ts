import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const ratingSync = readFileSync("supabase/functions/kfsp-rating-sync/index.ts", "utf8")
const ttaiSync = readFileSync("supabase/functions/kfsp-ttai-history-sync/index.ts", "utf8")
const candidateMigrationPath = "supabase/migrations/20260901221500_kfsp_canonical_rating_candidate_split.sql"
const manualDispatchMigrationPath = "supabase/migrations/20260901224000_kfsp_manual_dispatch_rpc.sql"
const manualDispatchFixMigrationPath = "supabase/migrations/20260901224500_fix_kfsp_manual_dispatch_rpc_ambiguity.sql"

function candidateMigration() {
  assert.ok(existsSync(candidateMigrationPath), "candidate-feed split migration must exist")
  return readFileSync(candidateMigrationPath, "utf8")
}

function manualDispatchMigration() {
  assert.ok(existsSync(manualDispatchMigrationPath), "manual dispatch migration must exist")
  return readFileSync(manualDispatchMigrationPath, "utf8")
}

function manualDispatchFixMigration() {
  assert.ok(existsSync(manualDispatchFixMigrationPath), "manual dispatch ambiguity fix must exist")
  return readFileSync(manualDispatchFixMigrationPath, "utf8")
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

test("KFSP recovery dispatch is one-shot, idempotent and keeps Vault credentials server-side", () => {
  const migration = manualDispatchMigration()
  const fixMigration = manualDispatchFixMigration()
  assert.match(migration, /create table if not exists public\.kfsp_manual_dispatch_runs/i)
  assert.match(migration, /request_id uuid primary key/i)
  assert.match(migration, /create or replace function public\.qeo_dispatch_kfsp_job/i)
  assert.match(migration, /security definer/i)
  assert.match(migration, /set search_path = ''/i)
  assert.match(migration, /vault\.decrypted_secrets/i)
  assert.match(migration, /where s\.name = 'kfsp_sync_secret'/i)
  assert.match(migration, /TTAI manual dispatch requires 1\.\.50 unique valid tickers/i)
  assert.match(migration, /manual_recovery_rpc/i)
  assert.match(migration, /p_requested_by text/i)
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i)
  assert.doesNotMatch(migration, /return.*v_secret/i)
  assert.match(fixMigration, /on conflict on constraint kfsp_manual_dispatch_runs_pkey do nothing/i)
  assert.doesNotMatch(fixMigration, /on conflict \(request_id\)/i)
})
