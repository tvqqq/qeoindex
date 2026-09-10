import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { diffUniverseTickers } from "../modules/market/chart-data/universe-bootstrap-policy.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
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

test("QEO-105 keeps failures isolated and publishes readiness only after Daily plus intraday verification", () => {
  const steps = source("modules/market/chart-data/universe-bootstrap-workflow-steps.ts")
  const workflow = source("workflows/chart-universe-bootstrap.ts")

  assert.match(workflow, /Promise\.all/)
  assert.match(steps, /provider_gap/)
  assert.match(steps, /retryable/)
  assert.match(steps, /dailyReady/)
  assert.match(steps, /intradayReady/)
  assert.match(steps, /status:\s*dailyReady\s*&&\s*intradayReady\s*\?\s*["']ready["']/)
})

test("QEO-105 automatically dispatches after publish without embedding secrets in migration text", () => {
  const route = source("app/api/qeoindex/eod/route.ts")
  const migration = source("supabase/migrations/20260910164500_qeo105_chart_universe_bootstrap.sql")

  assert.match(route, /mode === "chart-universe-bootstrap"/)
  assert.match(route, /chartUniverseBootstrapWorkflow/)
  assert.match(route, /transitionId/)
  assert.match(migration, /net\.http_post/)
  assert.match(migration, /qeoindex_app_url/)
  assert.match(migration, /qeoindex_cron_secret/)
  assert.match(migration, /mode=chart-universe-bootstrap/)
  assert.doesNotMatch(migration, /Bearer\s+[A-Za-z0-9._-]{20,}/)
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
