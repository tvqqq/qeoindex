import assert from "node:assert/strict"
import test from "node:test"

import { buildVerifiedNoTradeDailyBar } from "../lib/qeoindex-eod-no-trade-repair-step.ts"

const tradedSnapshot = {
  symbol: "FPT",
  session_date: "2026-09-03",
  reference_price: 73.2,
  latest_price: 72.2,
  total_volume: 3_922_100,
  updated_at: "2026-09-03T07:45:07.883Z",
  latest_quote: {
    openPrice: 73,
    highPrice: 73,
    lowPrice: 72,
    matchPrice: 72.2,
    totalVolume: 3_922_100,
  },
}

test("verified final traded snapshot repairs a missing current-session Daily bar", () => {
  const bar = buildVerifiedNoTradeDailyBar("FPT", "2026-09-03", tradedSnapshot)

  assert.deepEqual(bar, {
    time: Math.floor(new Date("2026-09-03T02:00:00.000Z").getTime() / 1000),
    open: 73,
    high: 73,
    low: 72,
    close: 72.2,
    volume: 3_922_100,
  })
})

test("verified final traded repair rejects inconsistent volume, match price, and OHLC evidence", () => {
  assert.equal(buildVerifiedNoTradeDailyBar("FPT", "2026-09-03", {
    ...tradedSnapshot,
    latest_quote: { ...tradedSnapshot.latest_quote, totalVolume: 3_900_000 },
  }), null)

  assert.equal(buildVerifiedNoTradeDailyBar("FPT", "2026-09-03", {
    ...tradedSnapshot,
    latest_quote: { ...tradedSnapshot.latest_quote, matchPrice: 72.1 },
  }), null)

  assert.equal(buildVerifiedNoTradeDailyBar("FPT", "2026-09-03", {
    ...tradedSnapshot,
    latest_quote: { ...tradedSnapshot.latest_quote, highPrice: 71.9 },
  }), null)
})
