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
const cleanRebuildMigrationPath = "supabase/migrations/20260901213000_clean_rebuild_top_stocks_200.sql"
const insightsPage = source("app/insights/page.tsx")

test("Wyckoff runtime reads canonical Supabase universe instead of Notion Top100", () => {
  assert.match(wyckoffRunner, /getCanonicalUniverse/)
  assert.doesNotMatch(wyckoffRunner, /getScannerDataFresh/)
  assert.doesNotMatch(wyckoffRunner, /CANONICAL_UNIVERSE_STOCKS/)
  assert.match(wyckoffApi, /getCanonicalUniverse/)
  assert.doesNotMatch(wyckoffPage, /getScannerData\(/)
  assert.doesNotMatch(wyckoffPage, /canonical Top 100|Notion compatibility/)
  assert.doesNotMatch(wyckoffApi, /getScannerData\(/)
  assert.doesNotMatch(obsoleteDashboard, /Top 100|top100/)
})

test("Wyckoff first render is canonical shell-first and does not block on provider history", () => {
  assert.match(wyckoffPage, /getCanonicalUniverse/)
  assert.match(wyckoffPage, /initialTicker=/)
  assert.match(wyckoffPage, /WyckoffDeferredDashboard/)
  assert.doesNotMatch(wyckoffPage, /getCachedLongDailyHistory|getCachedHourlyHistory|getCachedDailyHistory/)
  assert.doesNotMatch(wyckoffPage, /buildWyckoffChartStudies/)
  assert.match(deferredDashboard, /dynamic\(/)
  assert.match(deferredDashboard, /ssr:\s*false/)
  assert.match(deferredDashboard, /requestAnimationFrame/)
  assert.match(deferredDashboard, /mode=watchlist/)
})

test("AI Council freshness validates against current canonical membership instead of exact 100", () => {
  assert.doesNotMatch(aiFreshness, /AI_COUNCIL_EXPECTED_STOCKS\s*=\s*100/)
  assert.doesNotMatch(aiFreshness, /Top100 universe incomplete/)
  assert.match(aiFreshness, /getCanonicalUniverse/)
  assert.match(aiFreshness, /canonical\.selectedCount/)
  assert.match(aiFreshness, /missingCanonical/)
})

test("runtime cache and realtime naming contain no Top100 membership semantics", () => {
  assert.doesNotMatch(realtime, /market:top100/)
  assert.doesNotMatch(intraday, /top100:v/)
  assert.doesNotMatch(intraday, /Top 100 5m/)
})

test("canonical universe cache follows the latest published run instead of a fixed current key", () => {
  assert.match(marketUniverse, /getCanonicalUniverseVersion/)
  assert.match(marketUniverse, /key:\s*`run:\$\{version\.runId\}`/)
  assert.doesNotMatch(marketUniverse, /const CACHE_KEY = "current"/)
  assert.match(universeVersionRoute, /getCanonicalUniverseVersion/)
  assert.doesNotMatch(universeVersionRoute, /getCanonicalUniverse\(\)/)
})

test("stock detail history deltas are normalized to at most two decimals", () => {
  assert.match(ratingModel, /Math\.round\(\(current - previous\) \* 100\) \/ 100/)
})

test("Notion flow is a canonical 200 mirror/staging contract, not Top100 source of truth", () => {
  assert.match(notionStaging, /WYCKOFF_V2_UNIVERSE_KEY = "vn_top_stocks"/)
  assert.match(notionStaging, /DEFAULT_UNIVERSE_COUNT = 200/)
  assert.match(notionStaging, /universeCount \* TIMEFRAME_COUNT/)
  assert.doesNotMatch(schedulePrompt, /hose_top100/)
  assert.doesNotMatch(schedulePrompt, /Universe Count = 100/)
  assert.doesNotMatch(schedulePrompt, /Snapshot Expected = 500/)
  assert.match(schedulePrompt, /vn_top_stocks/)
  assert.match(schedulePrompt, /1000|Universe Count = 200/)
})

test("canonical selector enforces the approved 4-of-5 daily trading activity gate", () => {
  assert.match(marketSelection, /MARKET_UNIVERSE_ACTIVITY_OBSERVATION_DAYS = 5/)
  assert.match(marketSelection, /MARKET_UNIVERSE_MIN_ACTIVE_DAYS = 4/)
  assert.match(marketSelection, /tradingObservationDays !== MARKET_UNIVERSE_ACTIVITY_OBSERVATION_DAYS/)
  assert.match(marketSelection, /tradingActiveDays < MARKET_UNIVERSE_MIN_ACTIVE_DAYS/)
})

test("board orderbook read model is canonical-only and publication prunes stale rows", () => {
  assert.match(boardStore, /getCanonicalBoardOverviewSnapshots/)
  assert.match(boardStore, /\.in\("symbol", normalizedSymbols\)/)
  assert.match(boardPage, /getCanonicalBoardOverviewSnapshots\(tickers\)/)
  assert.match(orderbookCleanupMigration, /qeo_prune_noncanonical_orderbook_snapshots/)
  assert.match(orderbookCleanupMigration, /market_universe_memberships/)
  assert.match(orderbookCleanupMigration, /after update of status, published_at/)
})

test("open board tabs refresh when canonical universe run changes", () => {
  assert.equal(existsSync("app/api/market-universe/version/route.ts"), true)
  assert.match(boardPage, /MarketUniverseVersionRefresh universeRunId=\{canonical\.runId\}/)
  assert.match(boardRefresh, /\/api\/market-universe\/version/)
  assert.match(boardRefresh, /payload\.runId !== universeRunId/)
  assert.match(boardRefresh, /router\.refresh\(\)/)
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
