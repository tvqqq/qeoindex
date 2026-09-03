import assert from "node:assert/strict"
import test from "node:test"

import { buildVerifiedNoTradeDailyBar } from "../lib/qeoindex-eod-no-trade-repair-step.ts"

test("verified final traded snapshot repairs a missing current-session Daily bar", () => {
  const bar = buildVerifiedNoTradeDailyBar("FPT", "2026-09-03", {
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
  })

  assert.deepEqual(bar, {
    time: Math.floor(new Date("2026-09-03T02:00:00.000Z").getTime() / 1000),
    open: 73,
    high: 73,
    low: 72,
    close: 72.2,
    volume: 3_922_100,
  })
})
