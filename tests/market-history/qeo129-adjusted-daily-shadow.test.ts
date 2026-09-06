import assert from "node:assert/strict"
import test from "node:test"

import {
  applyDailyAdjustment,
  factorForSession,
  type ShadowFactorRun,
  type ShadowFactorTransition,
} from "../../modules/market/history/adjusted-daily.ts"

const lineageHash = "a".repeat(64)

const run: ShadowFactorRun = {
  id: "00000000-0000-4000-8000-000000000129",
  ticker: "VHM",
  factorVersion: `qeo124-v1:${lineageHash}`,
  engineVersion: "qeo124-v1",
  eventLineageHash: lineageHash,
  status: "candidate",
}

const transitions: ShadowFactorTransition[] = [
  {
    effectiveSession: "2026-06-29",
    cumulativePriceFactor: 13 / 27,
    cumulativeVolumeFactor: 2,
  },
  {
    effectiveSession: "2026-08-06",
    cumulativePriceFactor: 1 / 2,
    cumulativeVolumeFactor: 2,
  },
]

function almostEqual(actual: number, expected: number, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
}

test("QEO-129 projects transition factors with strict next-effective-session semantics", () => {
  assert.deepEqual(factorForSession("2025-10-15", transitions), {
    priceFactor: 13 / 27,
    volumeFactor: 2,
  })

  assert.deepEqual(factorForSession("2026-06-29", transitions), {
    priceFactor: 1 / 2,
    volumeFactor: 2,
  })

  assert.deepEqual(factorForSession("2026-08-06", transitions), {
    priceFactor: 1,
    volumeFactor: 1,
  })
})

test("QEO-129 applies price and volume factors independently and preserves exact lineage", () => {
  const adjusted = applyDailyAdjustment({
    raw: {
      ticker: "VHM",
      sessionDate: "2026-06-29",
      barTime: "2026-06-29T02:00:00.000Z",
      open: 100,
      high: 120,
      low: 90,
      close: 110,
      volume: 1_000,
    },
    run,
    transitions,
  })

  almostEqual(adjusted.open, 50)
  almostEqual(adjusted.high, 60)
  almostEqual(adjusted.low, 45)
  almostEqual(adjusted.close, 55)
  almostEqual(adjusted.volume, 2_000)
  assert.equal(adjusted.sessionDate, "2026-06-29")
  assert.equal(adjusted.barTime, "2026-06-29T02:00:00.000Z")
  assert.equal(adjusted.rawBarTime, "2026-06-29T02:00:00.000Z")
  assert.equal(adjusted.factorRunId, run.id)
  assert.equal(adjusted.factorVersion, run.factorVersion)
  assert.equal(adjusted.eventLineageHash, run.eventLineageHash)
  assert.equal(adjusted.adjustmentEngineVersion, run.engineVersion)
})

test("QEO-129 keeps an explicit identity factor after the final transition while retaining factor-run lineage", () => {
  const adjusted = applyDailyAdjustment({
    raw: {
      ticker: "VHM",
      sessionDate: "2026-08-07",
      barTime: "2026-08-07T02:00:00.000Z",
      open: 80,
      high: 82,
      low: 78,
      close: 81,
      volume: 500,
    },
    run,
    transitions,
  })

  assert.equal(adjusted.open, 80)
  assert.equal(adjusted.high, 82)
  assert.equal(adjusted.low, 78)
  assert.equal(adjusted.close, 81)
  assert.equal(adjusted.volume, 500)
  assert.equal(adjusted.factorRunId, run.id)
  assert.equal(adjusted.eventLineageHash, lineageHash)
})

test("QEO-129 fails closed on non-consumable factor-run status", () => {
  assert.throws(
    () => applyDailyAdjustment({
      raw: {
        ticker: "VHM",
        sessionDate: "2026-06-29",
        barTime: "2026-06-29T02:00:00.000Z",
        open: 100,
        high: 120,
        low: 90,
        close: 110,
        volume: 1_000,
      },
      run: { ...run, status: "blocked" },
      transitions,
    }),
    /factor run status/i,
  )
})

test("QEO-129 rejects duplicate, unsorted, or invalid transition factors", () => {
  assert.throws(
    () => factorForSession("2026-01-02", [transitions[1], transitions[0]]),
    /strictly increasing/i,
  )

  assert.throws(
    () => factorForSession("2026-01-02", [transitions[0], { ...transitions[0] }]),
    /strictly increasing/i,
  )

  assert.throws(
    () => factorForSession("2026-01-02", [
      { effectiveSession: "2026-06-29", cumulativePriceFactor: 0, cumulativeVolumeFactor: 1 },
    ]),
    /factor transition/i,
  )

  assert.throws(
    () => factorForSession("2026-01-02", [
      { effectiveSession: "2026-06-29", cumulativePriceFactor: 1, cumulativeVolumeFactor: Number.POSITIVE_INFINITY },
    ]),
    /factor transition/i,
  )
})

test("QEO-129 rejects ticker mismatch and invalid adjusted numeric output", () => {
  assert.throws(
    () => applyDailyAdjustment({
      raw: {
        ticker: "VIC",
        sessionDate: "2026-06-29",
        barTime: "2026-06-29T02:00:00.000Z",
        open: 100,
        high: 120,
        low: 90,
        close: 110,
        volume: 1_000,
      },
      run,
      transitions,
    }),
    /ticker/i,
  )

  assert.throws(
    () => applyDailyAdjustment({
      raw: {
        ticker: "VHM",
        sessionDate: "2026-06-29",
        barTime: "2026-06-29T02:00:00.000Z",
        open: Number.POSITIVE_INFINITY,
        high: Number.POSITIVE_INFINITY,
        low: 90,
        close: 110,
        volume: 1_000,
      },
      run,
      transitions,
    }),
    /raw Daily/i,
  )
})

test("QEO-129 refuses adjusted or unknown source basis before applying any factor", () => {
  const baseRaw = {
    ticker: "VHM",
    sessionDate: "2025-10-15",
    barTime: "2025-10-15T02:00:00.000Z",
    open: 120,
    high: 131.5,
    low: 114.6,
    close: 125,
    volume: 1_000,
  }

  for (const sourcePriceBasis of ["ADJUSTED", "UNKNOWN", undefined] as const) {
    assert.throws(
      () => applyDailyAdjustment({
        raw: { ...baseRaw, sourcePriceBasis } as any,
        run,
        transitions,
      }),
      /raw price basis/i,
    )
  }
})
