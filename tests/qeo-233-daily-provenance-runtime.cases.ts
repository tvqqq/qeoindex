import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import { assertQeo232DailyProvenanceSchema } from "./helpers/qeo-232-daily-provenance-schema-contract.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function qeo233MigrationSource() {
  const migrationDir = new URL("../supabase/migrations/", import.meta.url)
  const matches = readdirSync(migrationDir)
    .filter((name) => /_qeo233_daily_ohlcv_provenance.*\.sql$/.test(name))
    .sort()
  assert.ok(matches.length >= 2, "QEO-233 schema + compatibility migrations must exist")
  return matches.map((name) => source(`supabase/migrations/${name}`)).join("\n")
}

test("QEO-233 additive migrations satisfy the approved QEO-232 schema contract", () => {
  const sql = qeo233MigrationSource()
  assert.doesNotThrow(() => assertQeo232DailyProvenanceSchema(sql))
})

test("QEO-233 exposes immutable exact provenance identities and a consistency guard", () => {
  const sql = qeo233MigrationSource()
  assert.match(sql, /qeo_market_ohlcv_provenance_identity_immutable_guard/i)
  assert.match(sql, /provenance identities are immutable/i)
  assert.match(sql, /create(?: or replace)? view public\.market_ohlcv_history_compat/i)
  assert.match(sql, /provenance_consistent/i)
  assert.match(sql, /history\.provider\s*=\s*registry\.provider/i)
  assert.match(sql, /history\.provider_detail\s*=\s*registry\.provider_detail/i)
  assert.match(sql, /history\.source_url\s*=\s*registry\.source_url/i)
  assert.match(sql, /create(?: or replace)? function public\.qeo_market_ohlcv_provenance_consistency_guard/i)
  assert.match(sql, /raise exception/i)
})

test("QEO-233 backfill is bounded, capacity-gated, restartable, and changes only provenance_id", () => {
  const sql = qeo233MigrationSource()
  assert.match(sql, /qeo_market_ohlcv_provenance_backfill_batch/i)
  assert.match(sql, /p_limit/i)
  assert.match(sql, /greatest\(1,\s*least\(p_limit,\s*5000\)\)/i)
  assert.match(sql, /(?:pg_catalog\.)?pg_database_size\((?:pg_catalog\.)?current_database\(\)\)/i)
  assert.match(sql, /p_max_database_bytes/i)
  assert.match(sql, /set\s+provenance_id\s*=/i)
  assert.doesNotMatch(sql, /set\s+(?:open|high|low|close|volume|provider|provider_detail|source_url|fetched_at)\s*=/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /truncate(?:\s+table)?\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /vacuum\s+full/i)
  assert.doesNotMatch(sql, /chart_ohlcv_provenance_batches/i)
})

test("QEO-233 centralizes exact dual-write behavior for all approved Daily writers", () => {
  const helperPath = "modules/market/history/daily-provenance.ts"
  assert.equal(existsSync(new URL(`../${helperPath}`, import.meta.url)), true, "shared Daily provenance helper is missing")
  const helper = source(helperPath)
  assert.match(helper, /export\s+async\s+function\s+persistDailyOhlcvRows/)
  assert.match(helper, /identity_version:\s*1/)
  assert.match(helper, /JSON\.stringify\(\[1,\s*row\.provider,\s*row\.provider_detail,\s*row\.source_url\]\)/)
  assert.match(helper, /onConflict:\s*["']identity_version,provider,provider_detail,source_url["']/)
  assert.match(helper, /provenance_id/)

  for (const path of [
    "modules/market/history/ohlcv-store.ts",
    "modules/market/history/daily-integrity.ts",
    "modules/eod/no-trade-repair-step.ts",
  ]) {
    const text = source(path)
    assert.match(text, /persistDailyOhlcvRows/)
  }
})

test("QEO-233 provenance-sensitive direct readers use the compatibility view", () => {
  for (const path of [
    "modules/market/history/ohlcv-store.ts",
    "modules/market/history/daily-integrity.ts",
    "modules/market/chart-data/service.ts",
    "modules/market/chart-data/maintenance.ts",
    "modules/market/history/daily-cold-history.ts",
  ]) {
    const text = source(path)
    assert.match(text, /market_ohlcv_history_compat/)
    assert.match(text, /provenance_consistent/)
  }
})

test("QEO-233 keeps grouped Daily tuple width and order unchanged", () => {
  const sql = qeo233MigrationSource()
  assert.match(
    sql,
    /jsonb_build_array\([\s\S]*?h\.bar_time\s*,\s*h\.open\s*,\s*h\.high\s*,\s*h\.low\s*,\s*h\.close\s*,\s*h\.volume\s*,\s*h\.provider\s*,\s*h\.provider_detail\s*,\s*h\.source_url\s*,\s*h\.fetched_at[\s\S]*?\)/i,
  )
  const decoder = source("modules/market/history/ohlcv-grouped.ts")
  assert.match(decoder, /COMPACT_DAILY_ROW_WIDTH\s*=\s*10/)
})