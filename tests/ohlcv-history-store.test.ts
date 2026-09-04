import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  buildHistoricalSourceUrl,
  DAILY_BACKFILL_DAYS,
  DAILY_DELTA_DAYS,
  HOURLY_BACKFILL_DAYS,
  HOURLY_DELTA_DAYS,
} from "../modules/market/history/contract.ts"
import {
  buildOhlcvRefreshPlan,
  normalizeOhlcvTickers,
  type OhlcvCoverage,
} from "../modules/market/history/ohlcv-store.ts"
import {
  buildVerifiedFinalDailyBar,
  buildVerifiedNoTradeDailyBar,
} from "../modules/eod/no-trade-repair-step.ts"
import {
  buildEodHistoryRefreshSummary,
  EodHistoryRefreshError,
  type OhlcvUniverseRefreshResult,
} from "../modules/eod/history-refresh.ts"

const NOW = new Date("2026-08-25T08:35:00.000Z")
const dnseHistorySource = readFileSync("modules/market/providers/dnse/history.ts", "utf8")
const yahooHistorySource = readFileSync("modules/market/providers/yahoo/history.ts", "utf8")
const marketHistorySource = readFileSync("modules/market/history/index.ts", "utf8")
const marketHistoryContractSource = readFileSync("modules/market/history/contract.ts", "utf8")
const vndirectHistoryPath = "lib/vndirect-history.ts"

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

test("DNSE bootstrap uses bounded Daily and Hourly request windows", () => {
  assert.match(dnseHistorySource, /DAILY_REQUEST_WINDOW_DAYS\s*=\s*366/)
  assert.match(dnseHistorySource, /HOURLY_REQUEST_WINDOW_DAYS\s*=\s*30/)
  assert.match(dnseHistorySource, /buildRequestWindows/)
  assert.match(dnseHistorySource, /requestOhlcWindows/)
  assert.match(dnseHistorySource, /dedupeBars/)
})

test("HISTORY_REFRESH provider waterfall has a bounded wall-clock budget", () => {
  assert.match(dnseHistorySource, /DAILY_ADAPTIVE_BUDGET_MS\s*=\s*30_000/)
  assert.match(dnseHistorySource, /const deadlineMs = Date\.now\(\) \+ DAILY_ADAPTIVE_BUDGET_MS/)
  assert.match(dnseHistorySource, /requestOhlcWindows\(symbol, resolution, from, to, DAILY_REQUEST_WINDOW_DAYS, DAILY_MIN_RETRY_WINDOW_DAYS, deadlineMs\)/)
  assert.match(dnseHistorySource, /Math\.min\(8_000, deadlineMs - Date\.now\(\)\)/)
  assert.match(yahooHistorySource, /YAHOO_REQUEST_TIMEOUT_MS\s*=\s*15_000/)
  assert.match(yahooHistorySource, /signal:\s*AbortSignal\.timeout\(YAHOO_REQUEST_TIMEOUT_MS\)/)
  assert.match(marketHistorySource, /adaptive deadline exceeded/)
})

test("Daily provider waterfall includes bounded clean-ticker VNDirect fallback", () => {
  assert.equal(existsSync(vndirectHistoryPath), true)
  assert.match(marketHistoryContractSource, /HistoricalProvider\s*=\s*"DNSE"\s*\|\s*"Fallback"\s*\|\s*"VNDirect"/)
  assert.match(marketHistorySource, /fetchVnDirectDailyOhlcv/)
  assert.match(marketHistorySource, /provider:\s*"VNDirect"/)
  assert.match(marketHistorySource, /Yahoo:[\s\S]*VNDirect:/)

  if (!existsSync(vndirectHistoryPath)) return
  const vndirectHistorySource = readFileSync(vndirectHistoryPath, "utf8")
  assert.match(vndirectHistorySource, /VNDIRECT_REQUEST_TIMEOUT_MS\s*=\s*15_000/)
  assert.match(vndirectHistorySource, /https:\/\/api-finfo\.vndirect\.com\.vn\/v4\/stock_prices/)
  assert.match(vndirectHistorySource, /code:\$\{ticker\}~date:gte:/)
  assert.match(vndirectHistorySource, /adOpen/)
  assert.match(vndirectHistorySource, /adHigh/)
  assert.match(vndirectHistorySource, /adLow/)
  assert.match(vndirectHistorySource, /adClose/)
  assert.match(vndirectHistorySource, /nmVolume/)
  assert.match(vndirectHistorySource, /signal:\s*AbortSignal\.timeout\(VNDIRECT_REQUEST_TIMEOUT_MS\)/)
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
  assert.deepEqual(buildVerifiedFinalDailyBar("FPT", "2026-09-03", tradedSnapshot), {
    time: Math.floor(new Date("2026-09-03T02:00:00.000Z").getTime() / 1000),
    open: 73,
    high: 73,
    low: 72,
    close: 72.2,
    volume: 3_922_100,
  })
})

test("verified final traded repair expands the range when ATC close makes a new high", () => {
  assert.deepEqual(buildVerifiedFinalDailyBar("VIC", "2026-09-03", {
    symbol: "VIC",
    session_date: "2026-09-03",
    reference_price: 236,
    latest_price: 244.5,
    total_volume: 7_042_100,
    updated_at: "2026-09-03T07:45:07.879Z",
    latest_quote: {
      openPrice: 232.9,
      highPrice: 244.3,
      lowPrice: 226,
      matchPrice: 244.5,
      totalVolume: 7_042_100,
    },
  }), {
    time: Math.floor(new Date("2026-09-03T02:00:00.000Z").getTime() / 1000),
    open: 232.9,
    high: 244.5,
    low: 226,
    close: 244.5,
    volume: 7_042_100,
  })
})

test("verified final traded repair rejects inconsistent volume and match price evidence", () => {
  assert.equal(buildVerifiedFinalDailyBar("FPT", "2026-09-03", {
    ...tradedSnapshot,
    latest_quote: { ...tradedSnapshot.latest_quote, totalVolume: 3_900_000 },
  }), null)
  assert.equal(buildVerifiedFinalDailyBar("FPT", "2026-09-03", {
    ...tradedSnapshot,
    latest_quote: { ...tradedSnapshot.latest_quote, matchPrice: 72.1 },
  }), null)
})

test("no-trade fallback rejects stale, price-drift, or traded snapshots without quote evidence", () => {
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
