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
const marketSectors = source("lib/market-sectors.ts")
const orderbookStore = source("lib/supabase/orderbook.ts")
const orderbookSync = source("supabase/functions/orderbook-sync/index.ts")
const boardPage = source("app/page.tsx")
const boardComponent = source("components/live-market-board-v2.tsx")
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

test("board orderbook read model and sync are canonical-only", () => {
  assert.match(orderbookStore, /getBoardOverviewSnapshotsFromSupabase\(symbols:/)
  assert.match(orderbookStore, /\.in\("symbol", normalizedSymbols\)/)
  assert.match(orderbookSync, /pruneNonCanonicalOrderbookRows/)
  assert.match(orderbookSync, /staleSymbols/)
  assert.match(boardPage, /getBoardOverviewSnapshotsFromSupabase\(tickers\)/)
})

test("open board tabs refresh when canonical universe run changes", () => {
  assert.equal(existsSync("app/api/market-universe/version/route.ts"), true)
  assert.match(boardPage, /universeRunId=\{canonical\.runId\}/)
  assert.match(boardComponent, /universeRunId:/)
  assert.match(boardComponent, /\/api\/market-universe\/version/)
  assert.match(boardComponent, /router\.refresh\(\)/)
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
