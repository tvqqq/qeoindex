import assert from "node:assert/strict"
import test from "node:test"

import {
  chartHistoryCacheStats,
  clearChartHistoryCache,
  requestChartRange,
  requestFreshChartRange,
  type ChartHistoryResponse,
  type ChartRangeInput,
} from "../../components/stock-detail/chart/chart-history.ts"

function response(input: ChartRangeInput): ChartHistoryResponse {
  return {
    ok: true,
    ticker: input.ticker,
    resolution: input.timeframe,
    from: input.from,
    to: input.to,
    bars: [{ time: input.to, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
    gaps: [],
    integrityIssues: [],
    coverage: { complete: true, state: "COMPLETE" },
    errors: [],
    metadata: {
      priceBasis: "RAW",
      provider: null,
      lastUpdatedAt: new Date(input.to * 1000).toISOString(),
      sessionState: "CLOSED",
      currentBarTime: null,
      persistedThrough: input.to,
    },
  }
}

test("QEO-172 fresh no-store request never joins an in-flight stable/default request", async () => {
  clearChartHistoryCache()
  const input: ChartRangeInput = { ticker: "VIC", timeframe: "1h", from: 1, to: 2 }
  const seen: Array<RequestInit["cache"]> = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.cache)
    await gate
    return new Response(JSON.stringify(response(input)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  const stable = requestChartRange(input, undefined, fetchImpl, {
    now: new Date("2026-09-12T10:00:00+07:00"),
  })
  const fresh = requestFreshChartRange(input, undefined, fetchImpl)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(seen.length, 2)
  assert.deepEqual(new Set(seen), new Set<RequestCache | undefined>(["default", "no-store"]))
  release()
  await Promise.all([stable, fresh])
})

test("QEO-172 repeated covered stable range is local, network-free and resolves within 50ms", async () => {
  clearChartHistoryCache()
  const input: ChartRangeInput = { ticker: "VCB", timeframe: "1h", from: 1, to: 2 }
  const now = new Date("2026-09-12T10:00:00+07:00")
  let fetchCount = 0
  const fetchImpl = async () => {
    fetchCount += 1
    return new Response(JSON.stringify(response(input)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  await requestChartRange(input, undefined, fetchImpl, { now })
  const startedAt = performance.now()
  await requestChartRange(input, undefined, fetchImpl, { now })
  const localMs = performance.now() - startedAt

  assert.equal(fetchCount, 1)
  assert.ok(localMs <= 50, `expected local cache reuse <= 50ms, got ${localMs.toFixed(3)}ms`)
  assert.equal(chartHistoryCacheStats().hits, 1)
})
