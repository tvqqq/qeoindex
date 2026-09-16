import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function migration(pattern: RegExp) {
  const dir = new URL("../supabase/migrations/", import.meta.url)
  const name = readdirSync(dir).find((entry) => pattern.test(entry))
  assert.ok(name, `Missing migration matching ${pattern}`)
  return source(`supabase/migrations/${name}`)
}

const bridgePattern = /_qeo234_daily_provenance_bridge\.sql$/
const cutoverPattern = /_qeo234_daily_provenance_cutover\.sql$/
const precedenceFixPattern = /_qeo234_registry_aware_daily_precedence\.sql$/

test("QEO-234 bridge makes long fields nullable and registry-canonical", () => {
  const sql = migration(bridgePattern)
  assert.match(sql, /alter\s+column\s+provider_detail\s+drop\s+not\s+null/i)
  assert.match(sql, /alter\s+column\s+source_url\s+drop\s+not\s+null/i)
  assert.match(sql, /market_ohlcv_history_compat/i)
  assert.match(sql, /registry\.provider_detail/i)
  assert.match(sql, /registry\.source_url/i)
  assert.match(sql, /history\.provider\s*=\s*registry\.provider/i)
})

test("QEO-234 precedence uses registry-backed logical provenance for compact updates", () => {
  const sql = migration(precedenceFixPattern)
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_preserve_daily_ohlcv_provider_precedence/i)
  assert.match(sql, /market_ohlcv_provenance/i)
  assert.match(sql, /to_jsonb\(old\)/i)
  assert.match(sql, /to_jsonb\(new\)/i)
  assert.match(sql, /old_provenance_id|old_registry/i)
  assert.match(sql, /new_provenance_id|new_registry/i)
  assert.match(sql, /internal:\/\/stock_orderbook_snapshots/i)
  assert.match(sql, /adjusted OHLC/i)
  assert.doesNotMatch(sql, /\bold\.source_url\b/i)
  assert.doesNotMatch(sql, /\bnew\.source_url\b/i)
  assert.doesNotMatch(sql, /\bold\.provider_detail\b/i)
  assert.doesNotMatch(sql, /\bnew\.provider_detail\b/i)
})

test("QEO-234 bridge migrates all live SQL provenance consumers", () => {
  const sql = migration(bridgePattern)
  for (const fn of [
    "qeo_market_ohlcv_recent",
    "qeo_market_daily_integrity_report",
    "qeo_market_daily_integrity_report_scoped",
  ]) assert.match(sql, new RegExp(fn, "i"))
  assert.match(sql, /from\s+public\.market_ohlcv_history_compat/i)
})

test("QEO-234 writer resolves logical provenance but persists a compact fact", () => {
  const helper = source("modules/market/history/daily-provenance.ts")
  assert.doesNotMatch(helper, /legacyUpsert|qeo233SchemaUnavailable/)
  assert.match(helper, /provenance_id/)
  assert.match(helper, /provider_detail/)
  assert.match(helper, /source_url/)
  assert.match(helper, /compactFacts|compactFact/)
})

test("QEO-234 provenance-sensitive readers have no direct long-field fallback", () => {
  for (const path of [
    "modules/market/history/ohlcv-store.ts",
    "modules/market/history/daily-integrity.ts",
    "modules/market/chart-data/service.ts",
    "modules/market/chart-data/maintenance.ts",
    "modules/market/history/daily-cold-history.ts",
  ]) {
    const text = source(path)
    assert.match(text, /market_ohlcv_history_compat/)
    assert.doesNotMatch(
      text,
      /from\(["']market_ohlcv_history["']\)[\s\S]{0,500}?select\(["'][^"']*(?:provider_detail|source_url)/,
      `${path} must not fall back to long provenance columns on the fact table`,
    )
  }
})

test("QEO-234 exposes a machine-only controlled writer canary", () => {
  const routePath = "app/api/qeoindex/daily-provenance-canary/route.ts"
  assert.equal(existsSync(new URL(`../${routePath}`, import.meta.url)), true)
  const route = source(routePath)
  const canary = source("modules/market/history/daily-provenance-canary.ts")
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(route, /qeo_verify_eod_scheduler_secret/)
  assert.match(route, /runDailyProvenanceCanary/)
  assert.doesNotMatch(route, /request\.json\(/)
  assert.match(canary, /persistDailyOhlcvRows/)
  assert.match(canary, /market_ohlcv_history_compat/)
})

test("QEO-234 final cutover drops only long inline provenance and retires backfill", () => {
  const sql = migration(cutoverPattern)
  assert.match(sql, /alter\s+column\s+provenance_id\s+set\s+not\s+null/i)
  assert.match(sql, /drop\s+column\s+provider_detail/i)
  assert.match(sql, /drop\s+column\s+source_url/i)
  assert.doesNotMatch(sql, /drop\s+column\s+provider\b/i)
  assert.doesNotMatch(sql, /drop\s+column\s+fetched_at\b/i)
  assert.match(sql, /drop\s+function\s+if\s+exists\s+public\.qeo_market_ohlcv_provenance_backfill_batch/i)
  assert.match(sql, /foreign key[\s\S]*on delete restrict|market_ohlcv_history_provenance_id_fkey/i)
  assert.doesNotMatch(sql, /vacuum\s+full/i)
  assert.doesNotMatch(sql, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /truncate(?:\s+table)?\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(sql, /chart_ohlcv_provenance_batches/i)
})

test("QEO-234 keeps grouped Daily tuple width/order and rollback reconstruction evidence", () => {
  const sql = `${migration(bridgePattern)}\n${migration(cutoverPattern)}`
  assert.match(sql, /jsonb_build_array\([\s\S]*?bar_time[\s\S]*?open[\s\S]*?high[\s\S]*?low[\s\S]*?close[\s\S]*?volume[\s\S]*?provider[\s\S]*?provider_detail[\s\S]*?source_url[\s\S]*?fetched_at/i)
  assert.match(source("modules/market/history/ohlcv-grouped.ts"), /COMPACT_DAILY_ROW_WIDTH\s*=\s*10/)
  const runbook = source("docs/db/runbooks/qeo234-daily-provenance-maintenance.md")
  assert.match(runbook, /ADD COLUMN provider_detail text/i)
  assert.match(runbook, /ADD COLUMN source_url text/i)
  assert.match(runbook, /market_ohlcv_provenance/i)
})
