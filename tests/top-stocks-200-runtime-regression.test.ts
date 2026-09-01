import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const wyckoffPage = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const wyckoffApi = readFileSync("app/api/insights/wyckoff/route.ts", "utf8")
const wyckoffRunner = readFileSync("lib/wyckoff-unified-runner.ts", "utf8")
const wyckoffUnified = readFileSync("lib/wyckoff-unified-data.ts", "utf8")
const aiFreshness = readFileSync("lib/ai-council-freshness.ts", "utf8")
const realtime = readFileSync("lib/supabase/realtime.ts", "utf8")
const intraday = readFileSync("lib/intraday-5m-service.ts", "utf8")
const insightsDashboard = readFileSync("components/insights/insights-dashboard.tsx", "utf8")
const notionStaging = readFileSync("lib/wyckoff-v2-notion-staging.ts", "utf8")
const schedulePrompt = readFileSync("scripts/chatgpt-plus-wyckoff-schedule-prompt.md", "utf8")

test("Wyckoff runtime reads canonical Supabase universe instead of Notion Top100", () => {
  assert.match(wyckoffRunner, /getCanonicalUniverse/)
  assert.doesNotMatch(wyckoffRunner, /getScannerDataFresh/)
  assert.doesNotMatch(wyckoffRunner, /CANONICAL_UNIVERSE_STOCKS/)
  assert.match(wyckoffUnified, /qeo_current_market_universe|getCanonicalUniverse/)
  assert.doesNotMatch(wyckoffPage, /getScannerData\(/)
  assert.doesNotMatch(wyckoffPage, /canonical Top 100|Notion compatibility/)
  assert.doesNotMatch(wyckoffApi, /getScannerData\(/)
})

test("Wyckoff first render is canonical shell-first and does not block on provider history", () => {
  assert.match(wyckoffPage, /getCanonicalUniverse/)
  assert.match(wyckoffPage, /initialData=|initialTicker=/)
  assert.doesNotMatch(wyckoffPage, /getCachedLongDailyHistory|getCachedHourlyHistory|getCachedDailyHistory/)
  assert.doesNotMatch(wyckoffPage, /buildWyckoffChartStudies/)
})

test("AI Council freshness uses caller canonical count instead of exact 100", () => {
  assert.doesNotMatch(aiFreshness, /AI_COUNCIL_EXPECTED_STOCKS\s*=\s*100/)
  assert.doesNotMatch(aiFreshness, /Top100 universe incomplete/)
  assert.match(aiFreshness, /expectedStocks/)
})

test("runtime cache and realtime naming contain no Top100 membership semantics", () => {
  assert.doesNotMatch(realtime, /market:top100/)
  assert.doesNotMatch(intraday, /top100:v/)
  assert.doesNotMatch(intraday, /Top 100 5m/)
})

test("stock detail numeric presentation is capped at two decimal places", () => {
  assert.match(insightsDashboard, /formatNumber\(row\.rsShort/)
  assert.match(insightsDashboard, /formatNumber\(row\.rsMedium/)
  assert.match(insightsDashboard, /formatSignedNumber\(deltaRs7d/)
  assert.match(insightsDashboard, /formatSignedNumber\(deltaRs30d/)
})

test("Notion flow is a canonical 200 mirror/staging contract, not Top100 source of truth", () => {
  assert.match(notionStaging, /WYCKOFF_V2_UNIVERSE_KEY = "vn_top_stocks"/)
  assert.doesNotMatch(schedulePrompt, /hose_top100/)
  assert.doesNotMatch(schedulePrompt, /Universe Count = 100/)
  assert.doesNotMatch(schedulePrompt, /Snapshot Expected = 500/)
  assert.match(schedulePrompt, /vn_top_stocks/)
  assert.match(schedulePrompt, /1000|Universe Count = 200/)
})
