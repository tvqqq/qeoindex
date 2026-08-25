import assert from "node:assert/strict"
import test from "node:test"

import { selectWyckoffV2Universe, type WyckoffV2UniverseRow } from "../lib/wyckoff-v2-universe.ts"

function universe(count = 100): WyckoffV2UniverseRow[] {
  return Array.from({ length: count }, (_, index) => ({
    ticker: `T${String(index + 1).padStart(3, "0")}`,
    active: true,
    exchange: "HOSE",
    rank: index + 1,
    sector: index % 2 ? "Industrials" : "Consumer",
  }))
}

test("v2 universe keeps 100 Active HOSE tickers and moves duplicate-rank anomaly behind valid ranks", () => {
  const rows = universe()
  rows[20] = { ...rows[20], ticker: "DMX", rank: 21 }
  rows[21] = { ...rows[21], ticker: "TCX", rank: 21 }
  // Remove rank 100 so the input still mirrors the current 99-unique-rank shape.
  rows[99] = { ...rows[99], rank: 99 }

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
