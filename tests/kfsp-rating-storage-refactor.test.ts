import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

const insightsSource = readFileSync("lib/insights-data.ts", "utf8")
const migrationPath = "supabase/migrations/20260902020424_kfsp_rating_storage_refactor.sql"
const stalePendingMigrationPath = "supabase/pending-migrations/20260902090000_kfsp_rating_storage_refactor.sql"

const runtimeRatingReaders = [
  "lib/insights-data.ts",
  "lib/ai-council-data.ts",
  "lib/ai-council-llm-evidence.ts",
  "lib/qeoindex-eod-archive-legacy.ts",
]

const legacyAliases = [
  "composite_score",
  "score_4m",
  "canslim_score",
  "stock_rs_score",
  "sector_rs_score",
  "stock_rrg_state",
  "sector_rrg_state",
]

function ratingSelectFragments(source: string) {
  const fragments = [...source.matchAll(/\.from\("insights_stock_ratings"\)\s*\.select\("([^"]*)"\)/g)]
    .map((match) => match[1])

  if (/\.from\("insights_stock_ratings"\)\s*\.select\(selection\)/.test(source)) {
    fragments.push(...[...source.matchAll(/const selection = "([^"]+)"/g)].map((match) => match[1]))
  }

  return fragments
}

test("production-applied rating contraction is active under the production ledger version", () => {
  assert.equal(existsSync(migrationPath), true)
  assert.equal(existsSync(stalePendingMigrationPath), false)
})

test("Insights runtime no longer reads duplicate industry_group", () => {
  assert.doesNotMatch(insightsSource, /industry_group/)
})

test("active rating readers use only KFSP canonical aliases", () => {
  for (const file of runtimeRatingReaders) {
    const source = readFileSync(file, "utf8")
    const ratingSelects = ratingSelectFragments(source)
    assert.ok(ratingSelects.length > 0, `${file} must expose an insights_stock_ratings select for this regression`)
    for (const selection of ratingSelects) {
      for (const alias of legacyAliases) {
        const genericOnly = new RegExp(`(?<!kfsp_)\\b${alias}\\b`)
        assert.doesNotMatch(selection, genericOnly, `${file} must use KFSP canonical ${alias}`)
      }
    }
  }
})

test("rating contraction migration creates bounded private raw evidence", () => {
  const sql = readFileSync(migrationPath, "utf8")
  assert.match(sql, /create table public\.kfsp_rating_raw_evidence/i)
  assert.match(sql, /primary key\s*\(sync_run_id,\s*ticker\)/i)
  assert.match(sql, /raw_payload\s+jsonb\s+not null/i)
  assert.match(sql, /interval\s+'30 days'/i)
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all on public\.kfsp_rating_raw_evidence from (?:public,\s*)?anon, authenticated/i)
  assert.match(sql, /grant select, insert, update, delete on public\.kfsp_rating_raw_evidence to service_role/i)
  assert.doesNotMatch(sql, /kfsp_rating_raw_evidence[\s\S]{0,500}references\s+public\.kfsp_rating_sync_runs/i)
})

test("publisher persists and prunes raw evidence while published ratings are canonical-only", () => {
  const sql = readFileSync(migrationPath, "utf8")
  assert.match(sql, /insert into public\.kfsp_rating_raw_evidence/i)
  assert.match(sql, /from public\.kfsp_rating_staging/i)
  assert.match(sql, /delete from public\.kfsp_rating_raw_evidence\s+where expires_at < now\(\)/i)
  assert.match(sql, /insert into public\.insights_stock_ratings/i)
  const publishedInsert = sql.match(/insert into public\.insights_stock_ratings[\s\S]*?from public\.kfsp_rating_staging/i)?.[0] ?? ""
  assert.doesNotMatch(publishedInsert, /\braw_payload\b/i)
  assert.doesNotMatch(publishedInsert, /\bindustry_group\b/i)
  for (const alias of legacyAliases) {
    const genericOnly = new RegExp(`(?<!kfsp_)\\b${alias}\\b`, "i")
    assert.doesNotMatch(publishedInsert, genericOnly)
  }
})

test("migration removes duplicate rating aliases and uses KFSP score indexes", () => {
  const sql = readFileSync(migrationPath, "utf8")
  for (const column of [
    ...legacyAliases,
    "industry_group",
    "raw_payload",
  ]) {
    assert.match(sql, new RegExp(`drop column if exists ${column}`, "i"))
  }
  assert.match(sql, /insights_stock_ratings_date_score_idx[\s\S]*kfsp_composite_score/i)
  assert.match(sql, /insights_stock_ratings_published_date_score_idx[\s\S]*kfsp_composite_score/i)
})
