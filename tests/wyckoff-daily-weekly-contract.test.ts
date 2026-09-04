import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(path, "utf8")
}

test("Wyckoff runtime supports exactly Daily and Weekly timeframes", () => {
  const model = source("modules/wyckoff/chart-model.ts")
  const contract = source("modules/wyckoff/eod-contract.ts")
  const builder = source("modules/wyckoff/eod-builder.ts")

  assert.match(model, /WYCKOFF_CHART_TIMEFRAMES\s*=\s*\["1D",\s*"1W"\]/)
  assert.match(contract, /TIMEFRAMES\s*=\s*\["1D",\s*"1W"\]/)
  assert.doesNotMatch(builder, /aggregateFourHour|aggregateMonthly|args\.hourly/)
})

test("persistent Wyckoff OHLCV accepts new Daily writes only without deleting legacy history", () => {
  const history = source("modules/market/history/ohlcv-store.ts")
  const cache = source("modules/wyckoff/eod-cache-read.ts")
  const migration = source("supabase/migrations/20260901190000_wyckoff_daily_weekly_storage_cutover.sql")

  assert.doesNotMatch(history, /fetchHourlyMarketHistoryWindow/)
  assert.doesNotMatch(cache, /"1H"/)
  assert.doesNotMatch(migration, /delete from public\.market_ohlcv_history/i)
  assert.doesNotMatch(migration, /delete from public\.wyckoff_analysis_snapshots/i)
  assert.doesNotMatch(migration, /delete from public\.wyckoff_chart_series/i)
  assert.match(migration, /alter table public\.market_ohlcv_history[\s\S]*?check \(timeframe = '1D'\) not valid/i)
  assert.match(migration, /alter table public\.wyckoff_analysis_snapshots[\s\S]*?check \(timeframe in \('1D', '1W'\)\) not valid/i)
  assert.match(migration, /alter table public\.wyckoff_chart_series[\s\S]*?check \(timeframe in \('1D', '1W'\)\) not valid/i)
})

test("EOD builds two Wyckoff snapshots per canonical ticker", () => {
  const steps = source("modules/eod/workflow-steps.ts")
  const phases = source("modules/admin/job-phases.ts")

  assert.match(steps, /expectedSnapshots\s*=\s*stocks\.length \* 2/)
  assert.doesNotMatch(steps, /hourlyFetchedBars/)
  assert.match(phases, /1D\/1W/)
  assert.match(phases, /universeCount × 2/)
})

test("Notion mirror and ingest accept exactly Daily and Weekly snapshots", () => {
  const staging = source("modules/wyckoff/eod-notion-staging.ts")
  const batch = source("modules/wyckoff/eod-notion-batch.ts")
  const ingest = source("modules/wyckoff/notion-ingest.ts")

  assert.match(staging, /TIMEFRAME_COUNT\s*=\s*2/)
  assert.match(batch, /TIMEFRAMES\s*=\s*\["1D",\s*"1W"\]/)
  assert.match(ingest, /TIMEFRAMES\s*=\s*new Set\(\["1D",\s*"1W"\]\)/)
  assert.match(ingest, /\.in\("timeframe",\s*\["1D",\s*"1W"\]\)/)
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
  const archive = source("modules/eod/archive.ts")
  const handoff = source("docs/HANDOVER.md")

  assert.doesNotMatch(archive, /timeframe:\s*"1D" \| "1H"|\["1D",\s*"1H"\]/)
  assert.match(handoff, /Wyckoff.*1D.*1W/i)
  assert.match(handoff, /raw OHLCV.*1D/i)
})