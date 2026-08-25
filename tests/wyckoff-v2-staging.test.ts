import assert from "node:assert/strict"
import test from "node:test"

import type { CachedOhlcvHistory } from "../lib/ohlcv-history-store.ts"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "../lib/wyckoff-v2-builder.ts"
import { selectWyckoffV2Universe, type WyckoffV2UniverseRow } from "../lib/wyckoff-v2-universe.ts"
import type { OhlcvBar } from "../lib/technical-indicators.ts"

function universe(count = 100): WyckoffV2UniverseRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ticker: `T${String(index + 1).padStart(3, "0")}`,
    active: true,
    exchange: "HOSE",
    rank: index + 1,
    sector: index % 2 ? "Industrials" : "Consumer",
  }))
}

function dailyBars(count: number, start = Date.UTC(2020, 0, 1) / 1000): OhlcvBar[] {
  return Array.from({ length: count }, (_, index) => {
    const price = 20 + index * 0.01 + Math.sin(index / 17) * 0.5
    return {
      time: start + index * 86400,
      open: price - 0.1,
      high: price + 0.4,
      low: price - 0.4,
      close: price,
      volume: 1_000_000 + (index % 20) * 10_000,
    }
  })
}

function hourlySessionBars(days: number, startDate = Date.UTC(2025, 10, 1)): OhlcvBar[] {
  const hoursUtc = [2, 3, 4, 6, 7] // 09:00,10:00,11:00,13:00,14:00 ICT
  const bars: OhlcvBar[] = []
  for (let day = 0; day < days; day += 1) {
    for (let slot = 0; slot < hoursUtc.length; slot += 1) {
      const index = day * hoursUtc.length + slot
      const price = 50 + index * 0.002 + Math.sin(index / 9) * 0.3
      bars.push({
        time: (startDate + day * 86400_000 + hoursUtc[slot] * 3600_000) / 1000,
        open: price - 0.05,
        high: price + 0.2,
        low: price - 0.2,
        close: price,
        volume: 400_000 + (index % 12) * 8_000,
      })
    }
  }
  return bars
}

function cached(ticker: string, timeframe: "1D" | "1H", bars: OhlcvBar[]): CachedOhlcvHistory {
  return {
    ticker,
    timeframe,
    bars,
    provider: "DNSE",
    detail: `DNSE cached ${timeframe}`,
    sourceUrl: `https://openapi.dnse.com.vn/price/ohlc?symbol=${ticker}&resolution=${timeframe}&type=STOCK`,
    fetchedAt: "2026-08-25T08:20:00.000Z",
    firstBarAt: new Date(bars[0].time * 1000).toISOString(),
    lastBarAt: new Date(bars.at(-1)!.time * 1000).toISOString(),
  }
}

function buildSnapshots(dailyCount: number): WyckoffV2Snapshot[] {
  const stock: WyckoffV2UniverseRow = { ticker: "MSN", active: true, exchange: "HOSE", rank: 15, sector: "Consumer" }
  return buildWyckoffV2TickerSnapshots({
    stock,
    daily: cached("MSN", "1D", dailyBars(dailyCount)),
    hourly: cached("MSN", "1H", hourlySessionBars(120)),
    runKey: "WYCKOFF-2026-08-25-EOD-v2",
    scanDate: "2026-08-25",
  })
}

test("v2 universe keeps 100 Active HOSE tickers and moves duplicate-rank anomaly behind valid ranks", () => {
  const rows = universe()
  rows[20] = { ...rows[20], ticker: "DMX", rank: 21 }
  rows[21] = { ...rows[21], ticker: "TCX", rank: 21 }

  const result = selectWyckoffV2Universe(rows)
  assert.equal(result.stocks.length, 100)
  assert.equal(new Set(result.stocks.map((row) => row.ticker)).size, 100)
  assert.ok(result.warnings.some((warning) => /duplicate Rank 21/i.test(warning)))
  assert.equal(result.stocks.at(-1)?.ticker, "TCX")
  assert.equal(result.stocks.find((row) => row.ticker === "TCX")?.rank, 21)
})

test("v2 universe moves missing and out-of-range rank anomalies to the deterministic tail without renumbering", () => {
  const rows = universe()
  rows[5] = { ...rows[5], ticker: "NULLR", rank: null }
  rows[6] = { ...rows[6], ticker: "OUTR", rank: 151 }

  const result = selectWyckoffV2Universe(rows)
  assert.deepEqual(result.stocks.slice(-2).map((row) => [row.ticker, row.rank]), [
    ["OUTR", 151],
    ["NULLR", null],
  ])
  assert.equal(result.warnings.length >= 2, true)
})

test("v2 universe hard-stops duplicate ticker, non-HOSE candidates and fewer than 100 unique Active HOSE", () => {
  const duplicate = universe()
  duplicate[99] = { ...duplicate[99], ticker: duplicate[0].ticker }
  assert.throws(() => selectWyckoffV2Universe(duplicate), /duplicate ticker/i)

  const nonHose = universe()
  nonHose[50] = { ...nonHose[50], exchange: "HNX" }
  assert.throws(() => selectWyckoffV2Universe(nonHose), /non-HOSE/i)

  assert.throws(() => selectWyckoffV2Universe(universe(99)), /fewer than 100/i)
})

test("v2 universe deterministically selects exactly 100 when more than 100 candidates exist", () => {
  const rows = universe(102)
  rows[100] = { ...rows[100], ticker: "AAA", rank: null }
  rows[101] = { ...rows[101], ticker: "ZZZ", rank: null }
  const result = selectWyckoffV2Universe(rows)
  assert.equal(result.stocks.length, 100)
  assert.equal(result.stocks.some((row) => row.ticker === "AAA"), false)
  assert.equal(result.stocks.some((row) => row.ticker === "ZZZ"), false)
})

test("cached v2 builder creates exactly five complete snapshot keys at the 60-bar contract", () => {
  const snapshots = buildSnapshots(2200)
  assert.deepEqual(snapshots.map((row) => row.timeframe), ["1H", "4H", "1D", "1W", "1M"])
  assert.equal(snapshots.length, 5)
  assert.equal(new Set(snapshots.map((row) => row.snapshotKey)).size, 5)
  assert.ok(snapshots.every((row) => row.snapshotKey === `${row.runKey}|MSN|${row.timeframe}`))
  assert.ok(snapshots.every((row) => row.historyStatus === "Complete"))
  assert.ok(snapshots.every((row) => row.historyBarCount >= 60))
})

test("complete v2 snapshots carry provider provenance, probability/scenario consistency and mapped horizons", () => {
  const snapshots = buildSnapshots(2200)
  const expectedHorizon = new Map([
    ["1H", "intraday"],
    ["4H", "swing"],
    ["1D", "week"],
    ["1W", "month"],
    ["1M", "long_term"],
  ])
  for (const row of snapshots) {
    assert.equal((row.bullProbability ?? 0) + (row.baseProbability ?? 0) + (row.bearProbability ?? 0), 100)
    assert.equal(row.scenarios.length, 3)
    assert.deepEqual(row.scenarios.map((scenario) => scenario.probability), [row.bullProbability, row.baseProbability, row.bearProbability])
    assert.ok(row.scenarios.every((scenario) => scenario.horizon === expectedHorizon.get(row.timeframe)))
    assert.equal(row.evidence.provider, "DNSE")
    assert.match(String(row.evidence.sourceUrl), /^https:\/\/openapi\.dnse\.com\.vn/)
    assert.equal(row.evidence.completedBars, row.historyBarCount)
    assert.ok(typeof row.evidence.firstBarAt === "string" && typeof row.evidence.lastBarAt === "string")
    assert.equal(row.evidence.missingReason, "")
    assert.ok((row.technical?.price ?? 0) > 0)
    assert.ok(row.barClosedAt)
  }
})

test("genuine short Monthly history becomes Incomplete without fabricated analysis or scenarios", () => {
  const snapshots = buildSnapshots(500)
  const monthly = snapshots.find((row) => row.timeframe === "1M")!
  assert.equal(monthly.historyStatus, "Incomplete")
  assert.ok(monthly.historyBarCount > 0 && monthly.historyBarCount < 60)
  assert.equal(monthly.phase, null)
  assert.equal(monthly.wyckoffState, null)
  assert.equal(monthly.taBias, null)
  assert.equal(monthly.confidence, null)
  assert.equal(monthly.bullProbability, null)
  assert.equal(monthly.baseProbability, null)
  assert.equal(monthly.bearProbability, null)
  assert.equal(monthly.support, null)
  assert.equal(monthly.resistance, null)
  assert.equal(monthly.confirmation, null)
  assert.equal(monthly.invalidation, null)
  assert.equal(monthly.whatChanged, null)
  assert.deepEqual(monthly.technical, {})
  assert.deepEqual(monthly.markers, [])
  assert.deepEqual(monthly.scenarios, [])
  assert.match(String(monthly.evidence.missingReason), /completed bars/i)
  assert.equal(monthly.validationStatus, "Valid")
})
