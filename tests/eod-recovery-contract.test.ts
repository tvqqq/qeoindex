import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("historical EOD recovery reads persistent Daily OHLCV rather than mutable orderbook state", () => {
  const backfill = source("lib/qeoindex-eod-backfill-ready-step.ts")
  const eodMarket = source("lib/ai-council-eod-market.ts")
  const eodData = source("lib/ai-council-eod-data.ts")
  const freshness = source("lib/ai-council-freshness.ts")
  const operations = source("lib/ai-council-operations.ts")

  assert.match(backfill, /market_ohlcv_history/)
  assert.doesNotMatch(backfill, /stock_orderbook_snapshots/)
  assert.match(eodMarket, /loadPersistentCouncilEodSnapshots/)
  assert.match(eodData, /loadPersistentCouncilEodSnapshots/)
  assert.match(freshness, /persistent_ohlcv/)
  assert.match(operations, /persistent_ohlcv/)
})

test("persistent freshness carries Wyckoff forward only for verified no-trade sessions", () => {
  const freshness = source("lib/ai-council-freshness.ts")
  assert.match(freshness, /isPersistentNoTradeCarryForward/)
  assert.match(freshness, /total_volume[^\n]*===?\s*0|Number\([^\n]*total_volume[^\n]*\)\s*===\s*0/)
  assert.match(freshness, /latest_price/)
  assert.match(freshness, /reference_price/)
  assert.match(freshness, /wyckoff.*bar_closed_at|bar_closed_at.*wyckoff/i)
})

test("current-session no-trade repair accepts the full canonical max-200 universe", () => {
  const repair = source("lib/qeoindex-eod-no-trade-repair-step.ts")
  assert.match(repair, /MAX_CANONICAL_UNIVERSE_SIZE\s*=\s*200/)
  assert.doesNotMatch(repair, /tickers\.length\s*>\s*100/)
  assert.doesNotMatch(repair, /1-100 unique tickers/)
})

test("recoverable history failures remain observable before exact-session repair while historical backfill fails closed", () => {
  const steps = source("lib/qeoindex-eod-workflow-steps.ts")
  const workflow = source("workflows/qeoindex-eod-pipeline.ts")

  assert.match(steps, /allowRecoverableFailures\s*=\s*false/)
  assert.match(steps, /result\.failedTickers > 0 && !allowRecoverableFailures/)
  assert.match(steps, /failedTickers:\s*result\.failedTickers/)
  assert.match(steps, /limitedCoverageCount:\s*result\.limitedCoverage\.length/)
  assert.match(workflow, /history\.completedTickers \+ history\.failedTickers !== universeCount/)
  assert.match(workflow, /runEodNoTradeDailyRepairStep/)
})
