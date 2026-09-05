import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  chartHistoryClass,
  clampChartHistoryRange,
  maxChartHistorySeconds,
} from "../modules/market/chart-data/history-policy.ts"
import { missingProviderRanges } from "../modules/market/chart-data/provider-coverage.ts"
import {
  MARKET_DATA_PROBE_PROVIDERS,
  ProviderProbeError,
  normalizeProbeRequest,
} from "../modules/market/provider-benchmark/contract.ts"
import {
  parseSsiIboardPayload,
  ssiIboardResolutionToken,
} from "../modules/market/provider-benchmark/providers/ssi-iboard.ts"

const DAY = 86400

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("QEO-100 chart history policy maps exact product horizons", () => {
  for (const resolution of ["1m", "15m", "30m"] as const) {
    assert.equal(chartHistoryClass(resolution), "SHORT")
    assert.equal(maxChartHistorySeconds(resolution), 31 * DAY)
  }
  for (const resolution of ["1h", "2h", "4h"] as const) {
    assert.equal(chartHistoryClass(resolution), "MID")
    assert.equal(maxChartHistorySeconds(resolution), 366 * DAY)
  }
  for (const resolution of ["1D", "3D", "1W", "1M", "1Q", "1Y"] as const) {
    assert.equal(chartHistoryClass(resolution), "LONG")
    assert.equal(maxChartHistorySeconds(resolution), null)
  }
})

test("QEO-100 history clamp never expands a request and clamps only short/mid lower bounds", () => {
  const to = 2_000_000_000
  const short = clampChartHistoryRange({ resolution: "15m", from: to - 60 * DAY, to, now: to + DAY })
  assert.deepEqual(short, { from: to - 31 * DAY, to, clamped: true })

  const mid = clampChartHistoryRange({ resolution: "4h", from: to - 500 * DAY, to, now: to + DAY })
  assert.deepEqual(mid, { from: to - 366 * DAY, to, clamped: true })

  const long = clampChartHistoryRange({ resolution: "1D", from: 1_000_000_000, to, now: to + DAY })
  assert.deepEqual(long, { from: 1_000_000_000, to, clamped: false })

  const alreadyNarrow = clampChartHistoryRange({ resolution: "1m", from: to - 3 * DAY, to, now: to + DAY })
  assert.deepEqual(alreadyNarrow, { from: to - 3 * DAY, to, clamped: false })
})

test("QEO-100 incomplete stored coverage backfills the missing head instead of trusting lastStored", () => {
  assert.deepEqual(
    missingProviderRanges(
      { from: 100, to: 1_000 },
      [{ from: 700, to: 1_000 }],
    ),
    [{ from: 100, to: 700 }],
  )

  assert.deepEqual(
    missingProviderRanges(
      { from: 100, to: 1_000 },
      [{ from: 100, to: 400 }, { from: 700, to: 1_000 }],
    ),
    [{ from: 400, to: 700 }],
  )

  assert.deepEqual(
    missingProviderRanges(
      { from: 100, to: 1_000 },
      [{ from: 700, to: 1_000 }, { from: 100, to: 750 }],
    ),
    [],
  )
})

test("QEO-100 1m loadOlder progressively hydrates the bounded horizon without gesture heuristics", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  assert.match(wrapper, /timeframe !== "1m" \|\| loading \|\| loadingOlder \|\| !hasMore/)
  assert.match(wrapper, /void loadOlder\(\)/)
  assert.doesNotMatch(wrapper, /onMouseMoveCapture/)
  assert.doesNotMatch(wrapper, /onWheelCapture/)
  assert.doesNotMatch(wrapper, /dragStartXRef/)
})

test("QEO-100 provider benchmark contract includes SSI iBoard first and bounded canonical resolutions", () => {
  assert.deepEqual(MARKET_DATA_PROBE_PROVIDERS, ["SSI_IBOARD", "DNSE", "VCI", "KBS"])
  assert.deepEqual(
    normalizeProbeRequest({ ticker: " vic ", resolution: "1m", from: 1_788_480_000, to: 1_788_566_400 }),
    { ticker: "VIC", resolution: "1m", from: 1_788_480_000, to: 1_788_566_400 },
  )
  assert.throws(() => normalizeProbeRequest({ ticker: "VIC", resolution: "15m" as never, from: 1, to: 2 }))
})

test("QEO-100 SSI iBoard parser normalizes UDF envelope and clips requested range", () => {
  const result = parseSsiIboardPayload({
    code: "SUCCESS",
    status: "ok",
    data: {
      s: "ok",
      t: [90, 100, 160, 220],
      o: [9, 10, 11, 12],
      h: [10, 12, 13, 13],
      l: [8, 9, 10, 11],
      c: [9.5, 11, 12, 12.5],
      v: [90, 100, 200, 300],
    },
  }, { ticker: "VIC", resolution: "1m", from: 100, to: 200 })

  assert.deepEqual(result.map((bar) => bar.time), [100, 160])
  assert.equal(result[0].open, 10)
  assert.equal(result[1].volume, 200)
  assert.equal(ssiIboardResolutionToken("1m"), "1")
  assert.equal(ssiIboardResolutionToken("1D"), "1D")
})

test("QEO-100 SSI iBoard parser rejects misaligned arrays as MALFORMED_RESPONSE", () => {
  assert.throws(
    () => parseSsiIboardPayload({
      code: "SUCCESS",
      status: "ok",
      data: { s: "ok", t: [100, 160], o: [1], h: [2, 2], l: [1, 1], c: [2, 2], v: [10, 20] },
    }, { ticker: "VIC", resolution: "1m", from: 100, to: 200 }),
    (error: unknown) => error instanceof ProviderProbeError && error.errorClass === "MALFORMED_RESPONSE",
  )
})
