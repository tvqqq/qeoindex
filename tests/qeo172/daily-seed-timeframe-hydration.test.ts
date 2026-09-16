import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import * as chartHistory from "../../components/stock-detail/chart/chart-history.ts"
import type { ChartTimeframe } from "../../components/stock-detail/chart/stock-chart-types.ts"
import type { OhlcvBar } from "../../modules/shared/technical/indicators.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

const dailyBars: OhlcvBar[] = [
  { time: 1788127200, open: 100, high: 103, low: 99, close: 102, volume: 1_000 },
  { time: 1788213600, open: 102, high: 104, low: 101, close: 103, volume: 1_100 },
  { time: 1788300000, open: 103, high: 105, low: 102, close: 104, volume: 1_200 },
  { time: 1788559200, open: 104, high: 106, low: 103, close: 105, volume: 1_300 },
  { time: 1788645600, open: 105, high: 108, low: 104, close: 107, volume: 1_400 },
  { time: 1788732000, open: 107, high: 109, low: 106, close: 108, volume: 1_500 },
  { time: 1788818400, open: 108, high: 110, low: 107, close: 109, volume: 1_600 },
  { time: 1788904800, open: 109, high: 111, low: 108, close: 110, volume: 1_700 },
]

test("QEO-172 every active timeframe can render deterministically from the SSR Daily seed", () => {
  const derive = (chartHistory as typeof chartHistory & {
    deriveChartBarsFromDailySeed?: (bars: OhlcvBar[], timeframe: ChartTimeframe) => OhlcvBar[]
  }).deriveChartBarsFromDailySeed

  assert.equal(typeof derive, "function", "chart-history must expose a canonical Daily-seed derivation helper")
  if (!derive) return

  for (const timeframe of ["1D", "3D", "1W", "1M", "1Q", "1Y"] as ChartTimeframe[]) {
    const bars = derive(dailyBars, timeframe)
    assert.ok(bars.length > 0, `${timeframe} must be renderable from Daily seed bars`)
    assert.equal(bars.at(-1)?.close, dailyBars.at(-1)?.close, `${timeframe} must preserve the latest completed close`)
  }

  assert.equal(derive(dailyBars, "1D").length, dailyBars.length)
  assert.ok(derive(dailyBars, "1W").length < dailyBars.length, "weekly seed must be aggregated rather than relabeled Daily bars")
})

test("QEO-172 persisted timeframe hydration commits from Daily seed before any remote history preparation", () => {
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")
  const hook = source("components/stock-detail/chart/use-chart-history.ts")
  const transition = wrapper.match(/const prepareAndCommit = useCallback\([\s\S]*?\n  }, \[[^\]]*\]\)/)?.[0] ?? ""

  assert.ok(transition, "prepareAndCommit implementation must remain discoverable")
  assert.match(transition, /deriveChartBarsFromDailySeed\(seedDailyBars,\s*nextTimeframe\)/)
  assert.match(transition, /if \(seededBars\.length > 0\)/)

  const seededDecision = transition.indexOf("seededBars.length > 0")
  const remotePrepare = transition.indexOf("prepareInitialChartHistory")
  assert.ok(seededDecision >= 0 && remotePrepare >= 0 && seededDecision < remotePrepare,
    "Daily seed must be considered before remote OHLCV preparation")

  assert.match(hook, /deriveChartBarsFromDailySeed\(seedDailyBars,\s*timeframe\)/)
  assert.doesNotMatch(hook, /timeframe === "1D" && seedDailyBars\.length > 0/)
})
