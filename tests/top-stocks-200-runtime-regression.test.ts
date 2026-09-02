import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(path, "utf8")
}

const wyckoffPage = source("app/insights/wyckoff/page.tsx")
const wyckoffApi = source("app/api/insights/wyckoff/route.ts")
const wyckoffRunner = source("lib/wyckoff-unified-runner.ts")
const deferredDashboard = source("components/insights/wyckoff-deferred-dashboard.tsx")
const obsoleteDashboard = source("components/insights/wyckoff-chart-dashboard.tsx")
const aiFreshness = source("lib/ai-council-freshness.ts")
const realtime = source("lib/supabase/realtime.ts")
const intraday = source("lib/intraday-5m-service.ts")
const ratingModel = source("lib/insights-rating-model.ts")
const notionStaging = source("lib/wyckoff-v2-notion-staging.ts")
const schedulePrompt = source("scripts/chatgpt-plus-wyckoff-schedule-prompt.md")
const marketSelection = source("lib/market-universe-selection.ts")
const marketUniverse = source("lib/market-universe.ts")
const marketSectors = source("lib/market-sectors.ts")
const boardStore = source("lib/supabase/board-overview.ts")
const boardPage = source("app/page.tsx")
const boardRefresh = source("components/market-universe-version-refresh.tsx")
const universeVersionRoute = source("app/api/market-universe/version/route.ts")
const orderbookCleanupMigration = source("supabase/migrations/20260901162500_prune_noncanonical_orderbook_snapshots.sql")
const cleanRebuildMigrationPath = "supabase/migrations/20260901144121_clean_rebuild_top_stocks_200.sql"
const cleanRebuildMarketSyncMigrationPath = "supabase/migrations/20260901214500_clean_rebuild_market_snapshot_trigger.sql"
const insightsPage = source("app/insights/page.tsx")
const marketSyncUniverse = source("lib/market-sync-universe.ts")
const orderbookSync = source("supabase/functions/orderbook-sync/index.ts")
const sessionCountdown = source("lib/session-countdown.ts")
const eodWorkflow = source("workflows/qeoindex-eod-pipeline.ts")

test("Wyckoff runtime reads canonical Supabase universe instead of Notion Top100", () => {
  assert.match(wyckoffRunner, /getCanonicalUniverse/)
  assert.doesNotMatch(wyckoffRunner, /getScannerDataFresh/)
  assert.doesNotMatch(wyckoffRunner, /CANONICAL_UNIVERSE_STOCKS/)
  assert.match(wyckoffApi, /getCanonicalUniverse/)
  assert.match(wyckoffPage, /loadWyckoffCanonicalShell/)
  assert.match(wyckoffPage, /prefetch=\{false\}/)
  assert.match(deferredDashboard, /WyckoffChartDashboard/)
  assert.match(obsoleteDashboard, /timeframes/)
})

test("Wyckoff first render is canonical shell-first and does not block on provider history", () => {
  assert.match(wyckoffPage, /loadWyckoffCanonicalShell/)
  assert.doesNotMatch(wyckoffPage, /getScannerDataFresh/)
  assert.doesNotMatch(wyckoffPage, /getMarketOhlcvBars/)
  assert.doesNotMatch(wyckoffPage, /fetchDailyHistory/)
  assert.match(wyckoffPage, /WyckoffDeferredDashboard/)
})

test("AI Council freshness validates against current canonical membership instead of exact 100", () => {
  assert.match(aiFreshness, /getCanonicalUniverse/)
  assert.match(aiFreshness, /expectedTickers/)
  assert.doesNotMatch(aiFreshness, /===\s*100/)
  assert.doesNotMatch(aiFreshness, /100\s*rows/)
})

test("runtime cache and realtime naming contain no Top100 membership semantics", () => {
  assert.doesNotMatch(realtime, /top100/i)
  assert.doesNotMatch(intraday, /top100/i)
  assert.doesNotMatch(ratingModel, /top100/i)
})

test("canonical universe cache follows the latest published run instead of a fixed current key", () => {
  assert.match(marketUniverse, /publishedAt/)
  assert.match(marketUniverse, /runId/)
  assert.match(universeVersionRoute, /runId/)
  assert.match(boardRefresh, /runId/)
})

test("stock detail history deltas are normalized to at most two decimals", () => {
  assert.match(ratingModel, /Math\.round\([^\n]*\*\s*100\)\s*\/\s*100/)
})

test("Notion flow is a canonical 200 mirror/staging contract, not Top100 source of truth", () => {
  assert.match(notionStaging, /canonical/i)
  assert.match(schedulePrompt, /200/)
  assert.doesNotMatch(schedulePrompt, /Top\s*100/i)
})

test("canonical selector enforces the approved 4-of-5 daily trading activity gate", () => {
  assert.match(marketSelection, /4/)
  assert.match(marketSelection, /5/)
  assert.match(marketSelection, /activity/i)
})

test("board orderbook read model is canonical-only and publication prunes stale rows", () => {
  assert.match(boardStore, /qeo_current_market_universe/)
  assert.match(orderbookCleanupMigration, /qeo_prune_orderbook_after_universe_publish/)
})

test("open board tabs refresh when canonical universe run changes", () => {
  assert.match(boardPage, /MarketUniverseVersionRefresh/)
  assert.match(boardRefresh, /router\.refresh/)
})

test("board sector taxonomy follows requested grouping rules", () => {
  assert.match(marketSectors, /đầu tư xây dựng/)
  assert.match(marketSectors, /return group\("real-estate"\)/)
  assert.match(marketSectors, /phân bón/)
  assert.match(marketSectors, /nông - lâm - ngư/)
  assert.match(marketSectors, /return group\("other"\)/)
})

test("Insights normalizes ticker-specific sectors and removes empty sector groups", () => {
  assert.equal(existsSync("lib/insights-sector-normalization.ts"), true)
  if (!existsSync("lib/insights-sector-normalization.ts")) return
  const normalizer = source("lib/insights-sector-normalization.ts")
  assert.match(normalizer, /YEG:\s*"Dịch vụ công ích"/)
  assert.match(normalizer, /TVC:\s*"Chứng khoán"/)
  assert.match(normalizer, /stockCount > 0/)
  assert.match(insightsPage, /normalizeInsightsDashboardSectors/)
})

test("clean rebuild is an explicit one-shot purge of rebuildable stock operational state", () => {
  assert.equal(existsSync(cleanRebuildMigrationPath), true)
  if (!existsSync(cleanRebuildMigrationPath)) return
  const migration = source(cleanRebuildMigrationPath)

  for (const table of [
    "market_ohlcv_history",
    "market_ohlcv_bootstrap_state",
    "wyckoff_analysis_snapshots",
    "wyckoff_chart_series",
    "wyckoff_universe_memberships",
    "wyckoff_scan_runs",
    "stock_orderbook_snapshots",
    "ai_council_runs",
  ]) {
    assert.match(migration, new RegExp(table))
  }

  assert.match(migration, /market_universe_memberships/)
  assert.match(migration, /market_universe_runs/)
  assert.doesNotMatch(migration, /truncate table[^;]*kfsp_provider_tokens/i)
  assert.doesNotMatch(migration, /truncate table[^;]*kfsp_ttai_quarterly_history/i)
  assert.doesNotMatch(migration, /truncate table[^;]*market_ohlcv_archive_ranges/i)
  assert.match(migration, /check \(timeframe = '1D'\)/)
  assert.match(migration, /check \(timeframe in \('1D', '1W'\)\)/)
})

test("clean rebuild has a service-role-only final market snapshot bootstrap trigger", () => {
  assert.equal(existsSync(cleanRebuildMarketSyncMigrationPath), true)
  if (!existsSync(cleanRebuildMarketSyncMigrationPath)) return
  const migration = source(cleanRebuildMarketSyncMigrationPath)
  assert.match(migration, /qeo_trigger_market_snapshot_bootstrap/)
  assert.match(migration, /functions\/v1\/orderbook-sync/)
  assert.match(migration, /revoke all on function public\.qeo_trigger_market_snapshot_bootstrap\(\) from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.qeo_trigger_market_snapshot_bootstrap\(\) to service_role/i)
})

test("live market collectors and EOD orchestration share the Vietnam trading-calendar guard", () => {
  assert.match(marketSyncUniverse, /isVietnamSecuritiesTradingDay/)
  assert.match(marketSyncUniverse, /skipped:\s*true/)
  assert.match(orderbookSync, /vn-market-calendar/)
  assert.match(orderbookSync, /isVietnamSecuritiesTradingDay/)
  assert.match(sessionCountdown, /isVietnamSecuritiesTradingDay/)
  assert.match(eodWorkflow, /isVietnamSecuritiesTradingDay/)
})
