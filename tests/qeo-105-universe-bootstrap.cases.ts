import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { diffUniverseTickers } from "../modules/market/chart-data/universe-bootstrap-policy.ts"
import { aggregateChartTimeframe, canonicalSourceResolution } from "../modules/market/chart-data/timeframes.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function epoch(value: string) {
  return Math.floor(Date.parse(value) / 1000)
}

test("QEO-105 computes exact added removed and unchanged membership from frozen run identities", () => {
  assert.deepEqual(
    diffUniverseTickers(["AAA", "BBB", "CCC"], ["CCC", "DDD", "AAA"]),
    {
      added: ["DDD"],
      removed: ["BBB"],
      unchanged: ["AAA", "CCC"],
    },
  )

  assert.deepEqual(
    diffUniverseTickers(["AAA", "BBB"], ["BBB", "AAA"]),
    { added: [], removed: [], unchanged: ["AAA", "BBB"] },
  )
})

test("QEO-105 transition persistence freezes exact universe IDs and never deletes OHLC history", () => {
  const migration = source("supabase/migrations/20260910164500_qeo105_chart_universe_bootstrap.sql")

  assert.match(migration, /chart_universe_bootstrap_transitions/)
  assert.match(migration, /previous_run_id/)
  assert.match(migration, /new_run_id/)
  assert.match(migration, /unique\s*\(new_run_id\)/i)
  assert.match(migration, /chart_universe_bootstrap_tickers/)
  assert.match(migration, /qeo_prepare_chart_universe_bootstrap_transition/)
  assert.match(migration, /qeo_claim_chart_universe_bootstrap_transition/)
  assert.match(migration, /after update of status, published_at/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.market_ohlcv_history/i)
  assert.doesNotMatch(migration, /delete\s+from\s+public\.chart_ohlcv_intraday/i)
})

test("QEO-105 first rollout establishes a complete baseline instead of treating canonical 200 as newly added", () => {
  const hardening = source("supabase/migrations/20260910170000_qeo105_chart_universe_bootstrap_hardening.sql")

  assert.match(hardening, /if v_previous_run_id is null then/i)
  assert.match(hardening, /v_added := '\{\}'::text\[\]/i)
  assert.match(hardening, /v_removed := '\{\}'::text\[\]/i)
  assert.match(hardening, /'baseline', v_previous_run_id is null/i)
})

test("QEO-105 bootstraps only added tickers through canonical Daily and QEO-107 intraday helpers", () => {
  const steps = source("modules/market/chart-data/universe-bootstrap-workflow-steps.ts")
  const workflow = source("workflows/chart-universe-bootstrap.ts")

  assert.match(steps, /refreshOhlcvHistoryBatch/)
  assert.match(steps, /bootstrapChartIntradayChunk/)
  assert.match(steps, /qeo107BootstrapTarget/)
  assert.match(steps, /dailyStatus\s*===\s*["']ready["']/)
  assert.match(steps, /intradayStatus\s*===\s*["']ready["']/)
  assert.match(workflow, /context\.addedTickers/)
  assert.doesNotMatch(workflow, /chartIntradayBootstrapWorkflow/)
  assert.doesNotMatch(workflow, /getCanonicalUniverse\(\)/)
})

test("QEO-105 keeps failures isolated and transition completion requires both Daily and intraday readiness", () => {
  const steps = source("modules/market/chart-data/universe-bootstrap-workflow-steps.ts")
  const workflow = source("workflows/chart-universe-bootstrap.ts")

  assert.match(workflow, /Promise\.all/)
  assert.match(steps, /provider_gap/)
  assert.match(steps, /retryable/)
  assert.match(steps, /dailyReady === tickers\.length && intradayReady === tickers\.length/)
  assert.match(steps, /status:\s*["']ready["']/)
})

test("QEO-105 automatically dispatches a dedicated machine-only route after publish without embedding secrets", () => {
  const route = source("app/api/qeoindex/chart-universe-bootstrap/route.ts")
  const migration = source("supabase/migrations/20260910164500_qeo105_chart_universe_bootstrap.sql")
  const hardening = source("supabase/migrations/20260910170000_qeo105_chart_universe_bootstrap_hardening.sql")

  assert.match(route, /chartUniverseBootstrapWorkflow/)
  assert.match(route, /transitionId/)
  assert.match(route, /qeo105-/)
  assert.match(route, /isSchedulerAuthorized/)
  assert.match(migration, /net\.http_post/)
  assert.match(hardening, /qeoindex_app_url/)
  assert.match(hardening, /qeoindex_cron_secret/)
  assert.match(hardening, /\/api\/qeoindex\/chart-universe-bootstrap\?transitionId=/)
  assert.doesNotMatch(`${migration}\n${hardening}`, /Bearer\s+[A-Za-z0-9._-]{20,}/)
})

test("QEO-105 is idempotent: same transition is uniquely keyed and ready stages are skipped", () => {
  const migration = source("supabase/migrations/20260910164500_qeo105_chart_universe_bootstrap.sql")
  const steps = source("modules/market/chart-data/universe-bootstrap-workflow-steps.ts")

  assert.match(migration, /on conflict \(new_run_id\)/i)
  assert.match(migration, /on conflict \(transition_id, ticker\)/i)
  assert.match(steps, /dailyStatus\s*===\s*["']ready["']/)
  assert.match(steps, /intradayStatus\s*===\s*["']ready["']/)
  assert.doesNotMatch(steps, /delete\(/)
})

test("QEO-105 populated canonical bases serve all supported chart families through deterministic aggregation", () => {
  const intraday = [
    { time: epoch("2026-09-10T09:00:00+07:00"), open: 10, high: 11, low: 9, close: 10.5, volume: 100 },
    { time: epoch("2026-09-10T09:15:00+07:00"), open: 10.5, high: 12, low: 10, close: 11.5, volume: 120 },
    { time: epoch("2026-09-10T13:00:00+07:00"), open: 11.5, high: 12, low: 11, close: 11.8, volume: 90 },
    { time: epoch("2026-09-10T13:15:00+07:00"), open: 11.8, high: 12.2, low: 11.6, close: 12, volume: 110 },
  ]
  const daily = [
    { time: epoch("2026-09-08T09:00:00+07:00"), open: 9, high: 10, low: 8.5, close: 9.5, volume: 1_000 },
    { time: epoch("2026-09-09T09:00:00+07:00"), open: 9.5, high: 10.5, low: 9, close: 10, volume: 1_100 },
    { time: epoch("2026-09-10T09:00:00+07:00"), open: 10, high: 11, low: 9.8, close: 10.8, volume: 1_200 },
  ]

  for (const resolution of ["1m", "15m", "30m", "1h", "2h", "4h"] as const) {
    assert.equal(canonicalSourceResolution(resolution), "1m")
    assert.ok(aggregateChartTimeframe(intraday, resolution).length > 0, resolution)
  }
  for (const resolution of ["1D", "3D", "1W", "1M", "1Q", "1Y"] as const) {
    assert.equal(canonicalSourceResolution(resolution), "1D")
    assert.ok(aggregateChartTimeframe(daily, resolution).length > 0, resolution)
  }
})
