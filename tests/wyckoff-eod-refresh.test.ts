import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  WYCKOFF_EOD_BATCH_SIZE,
  WYCKOFF_EOD_EXPECTED_STOCKS,
  buildWyckoffEodBatchOffsets,
  validateWyckoffEodDailyRows,
} from "../lib/wyckoff-eod-refresh.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("EOD refresh plans the Top100 as ten bounded batches", () => {
  assert.equal(WYCKOFF_EOD_EXPECTED_STOCKS, 100)
  assert.equal(WYCKOFF_EOD_BATCH_SIZE, 10)
  assert.deepEqual(buildWyckoffEodBatchOffsets(), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
})

test("EOD refresh rejects a mixed-session 1D snapshot set", () => {
  const tickers = ["AAA", "BBB", "CCC"]
  const result = validateWyckoffEodDailyRows({
    expectedSessionDate: "2026-08-24",
    expectedTickers: tickers,
    rows: [
      { ticker: "AAA", timeframe: "1D", bar_closed_at: "2026-08-24T07:00:00.000Z" },
      { ticker: "BBB", timeframe: "1D", bar_closed_at: "2026-08-21T07:00:00.000Z" },
    ],
  })

  assert.equal(result.ok, false)
  assert.equal(result.freshCount, 1)
  assert.deepEqual(result.staleOrMissingTickers, ["BBB", "CCC"])
})

test("EOD refresh accepts an exact same-session 1D snapshot set", () => {
  const result = validateWyckoffEodDailyRows({
    expectedSessionDate: "2026-08-24",
    expectedTickers: ["AAA", "BBB"],
    rows: [
      { ticker: "AAA", timeframe: "1D", bar_closed_at: "2026-08-24T07:00:00.000Z" },
      { ticker: "BBB", timeframe: "1D", bar_closed_at: "2026-08-24T07:00:00.000Z" },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.freshCount, 2)
  assert.deepEqual(result.staleOrMissingTickers, [])
})

test("operational Wyckoff runner bypasses UI history caches for EOD decisions", () => {
  const runner = source("lib/wyckoff-unified-runner.ts")

  assert.match(runner, /fetchLongDailyMarketHistory/)
  assert.match(runner, /fetchHourlyMarketHistory/)
  assert.doesNotMatch(runner, /getCachedLongDailyHistory|getCachedHourlyHistory|request-cache/)
})
