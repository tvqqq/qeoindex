import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const wyckoffPage = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const wyckoffApi = readFileSync("app/api/insights/wyckoff/route.ts", "utf8")
const wyckoffRunner = readFileSync("lib/wyckoff-unified-runner.ts", "utf8")
const deferredDashboard = readFileSync("components/insights/wyckoff-deferred-dashboard.tsx", "utf8")
const obsoleteDashboard = readFileSync("components/insights/wyckoff-chart-dashboard.tsx", "utf8")
const aiFreshness = readFileSync("lib/ai-council-freshness.ts", "utf8")
const realtime = readFileSync("lib/supabase/realtime.ts", "utf8")
const intraday = readFileSync("lib/intraday-5m-service.ts", "utf8")
const ratingModel = readFileSync("lib/insights-rating-model.ts", "utf8")
const notionStaging = readFileSync("lib/wyckoff-v2-notion-staging.ts", "utf8")
const schedulePrompt = readFileSync("scripts/chatgpt-plus-wyckoff-schedule-prompt.md", "utf8")

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
