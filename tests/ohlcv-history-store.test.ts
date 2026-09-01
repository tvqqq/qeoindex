import assert from "node:assert/strict"
import test from "node:test"

import { fetchDailyOhlcv as fetchDnseDailyOhlcv, fetchHourlyOhlcv as fetchDnseHourlyOhlcv } from "../lib/dnse-history.ts"
import {
  buildHistoricalSourceUrl,
  DAILY_BACKFILL_DAYS,
  DAILY_DELTA_DAYS,
  HOURLY_BACKFILL_DAYS,
  HOURLY_DELTA_DAYS,
} from "../lib/market-history-contract.ts"
import {
  buildOhlcvRefreshPlan,
  normalizeOhlcvTickers,
  type OhlcvCoverage,
} from "../lib/ohlcv-history-store.ts"
import { buildVerifiedNoTradeDailyBar } from "../lib/qeoindex-eod-no-trade-repair-step.ts"
import {
  buildEodHistoryRefreshSummary,
  EodHistoryRefreshError,
  type OhlcvUniverseRefreshResult,
} from "../lib/eod-history-refresh.ts"

const NOW = new Date("2026-08-25T08:35:00.000Z")

test("historical source URLs are deterministic and contain no credentials", () => {
  const dnse = buildHistoricalSourceUrl("DNSE", "msn", "1D", 14, NOW)
  assert.match(dnse, /^https:\/\/openapi\.dnse\.com\.vn\/price\/ohlc\?/)
  assert.match(dnse, /symbol=MSN/)
  assert.match(dnse, /resolution=1D/)
  assert.match(dnse, /type=STOCK/)
  assert.doesNotMatch(dnse, /api[_-]?key|signature|secret|token/i)

  const yahoo = buildHistoricalSourceUrl("Fallback", "hpg", "1H", 7, NOW)
  assert.match(yahoo, /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/HPG\.VN\?/)
  assert.match(yahoo, /interval=60m/)
  assert.doesNotMatch(yahoo, /cookie|authorization|token/i)
})

test("DNSE Daily backfill splits multi-year history into bounded request windows", async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.DNSE_API_KEY
  const originalSecret = process.env.DNSE_API_SECRET
  const windows: Array<{ from: number; to: number }> = []
  process.env.DNSE_API_KEY = "test-key"
  process.env.DNSE_API_SECRET = "test-secret"

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url)
    const from = Number(url.searchParams.get("from"))
    const to = Number(url.searchParams.get("to"))
    windows.push({ from, to })
    return new Response(JSON.stringify({
      t: [from + 3600],
      o: [10], h: [11], l: [9], c: [10.5], v: [1000],
    }), { status: 200 })
  }) as typeof fetch

  try {
    const bars = await fetchDnseDailyOhlcv("VGI", NOW, 800)
    assert.ok(windows.length >= 3, `expected at least 3 bounded requests, received ${windows.length}`)
    assert.ok(windows.every(({ from, to }) => to - from <= 366 * 86400))
    assert.equal(bars.length, windows.length)
    assert.deepEqual(bars.map((bar) => bar.time), [...bars.map((bar) => bar.time)].sort((a, b) => a - b))
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.DNSE_API_KEY
    else process.env.DNSE_API_KEY = originalKey
    if (originalSecret === undefined) delete process.env.DNSE_API_SECRET
    else process.env.DNSE_API_SECRET = originalSecret
  }
})

test("DNSE Hourly backfill splits long intraday history into bounded request windows", async () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env.DNSE_API_KEY
  const originalSecret = process.env.DNSE_API_SECRET
  const windows: Array<{ from: number; to: number }> = []
  process.env.DNSE_API_KEY = "test-key"
  process.env.DNSE_API_SECRET = "test-secret"

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url)
    const from = Number(url.searchParams.get("from"))
    const to = Number(url.searchParams.get("to"))
    windows.push({ from, to })
    return new Response(JSON.stringify({
      t: [from + 3600, from + 7200],
      o: [10, 10.5], h: [11, 11], l: [9, 10], c: [10.5, 10.8], v: [1000, 1200],
    }), { status: 200 })
  }) as typeof fetch

  try {
    const bars = await fetchDnseHourlyOhlcv("VGI", NOW, 120)
    assert.ok(windows.length >= 4, `expected at least 4 bounded requests, received ${windows.length}`)
    assert.ok(windows.every(({ from, to }) => to - from <= 31 * 86400))
    assert.equal(bars.length, windows.length * 2)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.DNSE_API_KEY
    else process.env.DNSE_API_KEY = originalKey
    if (originalSecret === undefined) delete process.env.DNSE_API_SECRET
    else process.env.DNSE_API_SECRET = originalSecret
  }
})

test("refresh planner backfills insufficient coverage then switches to bounded deltas", () => {
  const emptyDaily = buildOhlcvRefreshPlan(null, "1D")
  assert.deepEqual(emptyDaily, { mode: "backfill", timeframe: "1D", lookbackDays: DAILY_BACKFILL_DAYS })

  const shortDaily: OhlcvCoverage = {
    ticker: "MSN",
    timeframe: "1D",
    rowCount: 1200,
    firstBarTime: "2021-10-01T00:00:00.000Z",
    lastBarTime: "2026-08-24T00:00:00.000Z",
    distinctMonths: 59,
  }
  assert.equal(buildOhlcvRefreshPlan(shortDaily, "1D").mode, "backfill")

  const completeDaily = { ...shortDaily, distinctMonths: 60, rowCount: 1500 }
  assert.deepEqual(buildOhlcvRefreshPlan(completeDaily, "1D"), {
    mode: "delta",
    timeframe: "1D",
    lookbackDays: DAILY_DELTA_DAYS,
  })

  const shortHourly: OhlcvCoverage = {
    ticker: "MSN",
    timeframe: "1H",
    rowCount: 239,
    firstBarTime: "2026-06-01T02:00:00.000Z",
    lastBarTime: "2026-08-24T07:00:00.000Z",
    distinctMonths: 0,
  }
  assert.deepEqual(buildOhlcvRefreshPlan(shortHourly, "1H"), {
    mode: "backfill",
    timeframe: "1H",
    lookbackDays: HOURLY_BACKFILL_DAYS,
  })

  assert.deepEqual(buildOhlcvRefreshPlan({ ...shortHourly, rowCount: 240 }, "1H"), {
    mode: "delta",
    timeframe: "1H",
    lookbackDays: HOURLY_DELTA_DAYS,
  })
})

test("ticker normalization preserves deterministic universe order and rejects invalid symbols", () => {
  assert.deepEqual(normalizeOhlcvTickers([" msn ", "HPG", "msn", "VIC"]), ["MSN", "HPG", "VIC"])
  assert.throws(() => normalizeOhlcvTickers(["MSN", "bad symbol"]), /Invalid ticker/)
  assert.throws(() => normalizeOhlcvTickers([]), /at least one ticker/)
})

test("verified final no-trade snapshot repairs a missing completed Daily bar", () => {
  const bar = buildVerifiedNoTradeDailyBar("CRV", "2026-08-27", {
    symbol: "CRV",
    session_date: "2026-08-27",
    reference_price: 23.5,
    latest_price: 23.5,
    total_volume: 0,
    updated_at: "2026-08-27T07:45:01.000Z",
  })

  assert.deepEqual(bar, {
    time: Math.floor(new Date("2026-08-27T02:00:00.000Z").getTime() / 1000),
    open: 23.5,
    high: 23.5,
    low: 23.5,
    close: 23.5,
    volume: 0,
  })
})

test("no-trade repair rejects stale, traded, or price-drift snapshots", () => {
  const base = {
    symbol: "LGC",
    session_date: "2026-08-27",
    reference_price: 64.8,
    latest_price: 64.8,
    total_volume: 0,
    updated_at: "2026-08-27T07:45:01.000Z",
  }

  assert.equal(buildVerifiedNoTradeDailyBar("LGC", "2026-08-27", { ...base, total_volume: 100 }), null)
  assert.equal(buildVerifiedNoTradeDailyBar("LGC", "2026-08-27", { ...base, latest_price: 65 }), null)
  assert.equal(buildVerifiedNoTradeDailyBar("LGC", "2026-08-27", { ...base, updated_at: "2026-08-27T07:44:59.000Z" }), null)
})

test("EOD HISTORY_REFRESH summary is compact and fail-closed on provider/runtime errors", () => {
  const successful: OhlcvUniverseRefreshResult = {
    requestedTickers: 2,
    completedTickers: 2,
    failedTickers: 0,
    dailyFetchedBars: 20,
    hourlyFetchedBars: 80,
    backfillOperations: 1,
    deltaOperations: 3,
    limitedCoverage: [{ ticker: "NEW", timeframe: "1D", actual: 22, required: 60, metric: "distinctMonths" }],
    errors: [],
  }
  assert.deepEqual(buildEodHistoryRefreshSummary(successful), {
    ok: true,
    requestedTickers: 2,
    completedTickers: 2,
    failedTickers: 0,
    dailyFetchedBars: 20,
    hourlyFetchedBars: 80,
    backfillOperations: 1,
    deltaOperations: 3,
    limitedCoverageCount: 1,
    limitedCoverage: successful.limitedCoverage,
  })

  const failed: OhlcvUniverseRefreshResult = {
    ...successful,
    completedTickers: 1,
    failedTickers: 1,
    errors: [{ ticker: "HPG", error: "provider timeout" }],
  }
  assert.throws(() => buildEodHistoryRefreshSummary(failed), (error: unknown) => {
    assert.ok(error instanceof EodHistoryRefreshError)
    assert.equal(error.code, "EOD_HISTORY_REFRESH_FAILED")
    assert.match(error.message, /1\/2/)
    return true
  })
})
