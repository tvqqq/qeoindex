import assert from "node:assert/strict"
import test from "node:test"

import type { CachedOhlcvHistory } from "../lib/ohlcv-history-store.ts"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "../lib/wyckoff-v2-builder.ts"
import { selectWyckoffV2Universe, type WyckoffV2UniverseRow } from "../lib/wyckoff-v2-universe.ts"
import type { OhlcvBar } from "../lib/technical-indicators.ts"

function universe(count = 200): WyckoffV2UniverseRow[] {
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

function cachedDaily(ticker: string, bars: OhlcvBar[]): CachedOhlcvHistory {
  return {
    ticker,
    timeframe: "1D",
    bars,
    provider: "DNSE",
    detail: "DNSE cached 1D",
    sourceUrl: `https://openapi.dnse.com.vn/price/ohlc?symbol=${ticker}&resolution=1D&type=STOCK`,
    fetchedAt: "2026-08-25T08:20:00.000Z",
    firstBarAt: new Date(bars[0].time * 1000).toISOString(),
    lastBarAt: new Date(bars.at(-1)!.time * 1000).toISOString(),
  }
}

function buildSnapshots(dailyCount: number): WyckoffV2Snapshot[] {
  const stock: WyckoffV2UniverseRow = { ticker: "MSN", active: true, exchange: "HOSE", rank: 15, sector: "Consumer" }
  return buildWyckoffV2TickerSnapshots({
    stock,
    daily: cachedDaily("MSN", dailyBars(dailyCount)),
    runKey: "WYCKOFF-2026-08-25-EOD-v3",
    scanDate: "2026-08-25",
  })
}

test("v2 universe keeps up to 200 supported-exchange tickers and moves duplicate-rank anomaly behind valid ranks", () => {
  const rows = universe()
  rows[40] = { ...rows[40], exchange: "HNX" }
  rows[80] = { ...rows[80], exchange: "UPCOM" }
  rows[20] = { ...rows[20], ticker: "DMX", rank: 21 }
  rows[21] = { ...rows[21], ticker: "TCX", rank: 21 }

  const result = selectWyckoffV2Universe(rows)
  assert.equal(result.stocks.length, 200)
  assert.equal(new Set(result.stocks.map((row) => row.ticker)).size, 200)
  assert.ok(result.stocks.some((row) => row.exchange === "HNX"))
  assert.ok(result.stocks.some((row) => row.exchange === "UPCOM"))
  assert.ok(result.warnings.some((warning) => /duplicate Rank 21/i.test(warning)))
  assert.equal(result.stocks.at(-1)?.ticker, "TCX")
  assert.equal(result.stocks.find((row) => row.ticker === "TCX")?.rank, 21)
})

test("v2 universe moves missing and out-of-range rank anomalies to the deterministic tail without renumbering", () => {
  const rows = universe()
  rows[5] = { ...rows[5], ticker: "NULLR", rank: null }
  rows[6] = { ...rows[6], ticker: "OUTR", rank: 201 }

  const result = selectWyckoffV2Universe(rows)
  assert.deepEqual(result.stocks.slice(-2).map((row) => [row.ticker, row.rank]), [
    ["OUTR", 201],
    ["NULLR", null],
  ])
  assert.equal(result.warnings.length >= 2, true)
})

test("v2 universe rejects duplicate ticker or unsupported exchange but allows HNX/UPCOM and fewer than 200", () => {
  const duplicate = universe()
  duplicate[199] = { ...duplicate[199], ticker: duplicate[0].ticker }
  assert.throws(() => selectWyckoffV2Universe(duplicate), /duplicate ticker/i)

  const multiExchange = universe(99)
  multiExchange[40] = { ...multiExchange[40], exchange: "HNX" }
  multiExchange[60] = { ...multiExchange[60], exchange: "UPCOM" }
  const selected = selectWyckoffV2Universe(multiExchange)
  assert.equal(selected.stocks.length, 99)

  const unsupported = universe()
  unsupported[50] = { ...unsupported[50], exchange: "OTC" }
  assert.throws(() => selectWyckoffV2Universe(unsupported), /unsupported exchange/i)
})

test("v2 universe deterministically caps at 200 when more than 200 candidates exist", () => {
  const rows = universe(202)
  rows[200] = { ...rows[200], ticker: "AAA", rank: null }
  rows[201] = { ...rows[201], ticker: "ZZZ", rank: null }
  const result = selectWyckoffV2Universe(rows)
  assert.equal(result.stocks.length, 200)
  assert.equal(result.stocks.some((row) => row.ticker === "AAA"), false)
  assert.equal(result.stocks.some((row) => row.ticker === "ZZZ"), false)
  assert.ok(result.warnings.some((warning) => /capped at 200/i.test(warning)))
})

test("cached v2 builder creates exactly Daily and Weekly snapshot keys", () => {
  const snapshots = buildSnapshots(2200)
  assert.deepEqual(snapshots.map((row) => row.timeframe), ["1D", "1W"])
  assert.equal(snapshots.length, 2)
  assert.equal(new Set(snapshots.map((row) => row.snapshotKey)).size, 2)
  assert.ok(snapshots.every((row) => row.snapshotKey === `${row.runKey}|MSN|${row.timeframe}`))
  assert.ok(snapshots.every((row) => row.historyStatus === "Complete"))
  assert.ok(snapshots.every((row) => row.historyBarCount >= 60))
})

test("complete v2 snapshots carry provider provenance, probability/scenario consistency and mapped horizons", () => {
  const snapshots = buildSnapshots(2200)
  const expectedHorizon = new Map([
    ["1D", "week"],
    ["1W", "month"],
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

test("genuine short Weekly history becomes Incomplete without fabricated analysis or scenarios", () => {
  const snapshots = buildSnapshots(200)
  const daily = snapshots.find((row) => row.timeframe === "1D")!
  const weekly = snapshots.find((row) => row.timeframe === "1W")!
  assert.equal(daily.historyStatus, "Complete")
  assert.equal(weekly.historyStatus, "Incomplete")
  assert.ok(weekly.historyBarCount > 0 && weekly.historyBarCount < 60)
  assert.equal(weekly.phase, null)
  assert.equal(weekly.wyckoffState, null)
  assert.equal(weekly.taBias, null)
  assert.equal(weekly.confidence, null)
  assert.equal(weekly.bullProbability, null)
  assert.equal(weekly.baseProbability, null)
  assert.equal(weekly.bearProbability, null)
  assert.equal(weekly.support, null)
  assert.equal(weekly.resistance, null)
  assert.equal(weekly.confirmation, null)
  assert.equal(weekly.invalidation, null)
  assert.equal(weekly.whatChanged, null)
  assert.deepEqual(weekly.technical, {})
  assert.deepEqual(weekly.markers, [])
  assert.deepEqual(weekly.scenarios, [])
  assert.match(String(weekly.evidence.missingReason), /completed bars/i)
  assert.equal(weekly.validationStatus, "Valid")
})
