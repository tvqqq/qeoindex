import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(path, "utf8")
}

test("Wyckoff runtime supports exactly Daily and Weekly timeframes", () => {
  const model = source("lib/wyckoff-chart-model.ts")
  const contract = source("lib/wyckoff-v2-contract.ts")
  const builder = source("lib/wyckoff-v2-builder.ts")

  assert.match(model, /WYCKOFF_CHART_TIMEFRAMES\s*=\s*\["1D",\s*"1W"\]/)
  assert.match(contract, /TIMEFRAMES\s*=\s*\["1D",\s*"1W"\]/)
  assert.doesNotMatch(builder, /aggregateFourHour|aggregateMonthly|args\.hourly/)
})

test("persistent Wyckoff OHLCV stores and refreshes Daily only", () => {
  const history = source("lib/ohlcv-history-store.ts")
  const cache = source("lib/wyckoff-v2-cache-read.ts")
  const migration = source("supabase/migrations/20260901190000_wyckoff_daily_weekly_storage_cutover.sql")

  assert.doesNotMatch(history, /fetchHourlyMarketHistoryWindow/)
  assert.doesNotMatch(cache, /"1H"/)
  assert.match(migration, /delete from public\.market_ohlcv_history\s+where timeframe <> '1D'/)
  assert.match(migration, /check \(timeframe = '1D'\)/)
})

test("EOD builds two Wyckoff snapshots per canonical ticker", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const phases = source("lib/admin/job-phases.ts")

  assert.match(steps, /expectedSnapshots\s*=\s*stocks\.length \* 2/)
  assert.doesNotMatch(steps, /hourlyFetchedBars/)
  assert.match(phases, /1D\/1W/)
  assert.match(phases, /universeCount × 2/)
})

test("active Wyckoff API and UI contract expose only Daily and Weekly", () => {
  const route = source("app/api/insights/wyckoff/route.ts")
  const page = source("app/insights/wyckoff/page.tsx")
  const listTypes = source("components/insights/wyckoff-chart-dashboard.tsx")
  const deferred = source("components/insights/wyckoff-deferred-dashboard.tsx")
  const dashboard = source("components/insights/wyckoff-daily-weekly-dashboard.tsx")

  assert.doesNotMatch(route, /getCachedHourlyHistory|phase1H|\["1H",\s*"1D",\s*"1W"\]/)
  assert.doesNotMatch(page, /phase1H/)
  assert.doesNotMatch(listTypes, /phase1H/)
  assert.match(deferred, /wyckoff-daily-weekly-dashboard/)
  assert.doesNotMatch(deferred, /wyckoff-infographic-dashboard/)
  assert.doesNotMatch(dashboard, /phase1H|"1H"|1H · 1D · 1W|1H → 1D → 1W/)
})

test("archive and handoff document the Daily Weekly storage contract", () => {
  const archive = source("lib/qeoindex-eod-archive.ts")
  const handoff = source("docs/HANDOVER.md")

  assert.doesNotMatch(archive, /timeframe:\s*"1D" \| "1H"|\["1D",\s*"1H"\]/)
  assert.match(handoff, /Wyckoff.*1D.*1W/i)
  assert.match(handoff, /raw OHLCV.*1D/i)
})
