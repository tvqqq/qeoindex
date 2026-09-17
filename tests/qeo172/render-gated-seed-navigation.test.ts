import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 direct timeframe intent does not rerender the whole workstation before chart render commit", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  const wrapper = source("components/stock-detail/stock-tradingview-chart-data.tsx")

  const timeframeHandler = workstation.match(
    /const handleChartTimeframeChange = useCallback\([\s\S]*?\n  }, \[[^\]]*\]\)/,
  )?.[0] ?? ""

  assert.ok(timeframeHandler, "workstation timeframe intent handler must remain discoverable")
  assert.match(timeframeHandler, /currentChartTimeframeRef\.current = timeframe/)
  assert.doesNotMatch(
    timeframeHandler,
    /setCurrentChartTimeframe/,
    "timeframe intent must not trigger a parent-wide rerender before the chart itself commits",
  )

  assert.match(workstation, /const \[renderedChart, setRenderedChart\] = useState/)
  assert.match(workstation, /onRendered=\{handleChartRendered\}/)
  assert.match(wrapper, /onRendered\?: \(ticker: string, timeframe: ChartTimeframe\) => void/)
  assert.match(
    wrapper,
    /setAttribute\([\s\S]*?"data-chart-rendered-key"[\s\S]*?onRendered\?\.\(ticker, timeframe\)/,
    "chart wrapper must report readiness only after publishing the rendered key",
  )
})

test("QEO-172 adjacent prefetch waits for the active chart to render and skips OHLCV for usable Daily seed", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  const prefetchStart = workstation.indexOf("const warmAdjacent")
  const prefetchEnd = workstation.indexOf("const [isChartMaximized", prefetchStart)
  const prefetchBlock = workstation.slice(Math.max(0, prefetchStart - 500), prefetchEnd)

  assert.ok(prefetchStart >= 0 && prefetchEnd > prefetchStart, "adjacent prefetch block must remain discoverable")
  assert.match(prefetchBlock, /if \(!renderedChart \|\| renderedChart\.ticker !== activeTicker\) return/)
  assert.match(prefetchBlock, /const timeframe = renderedChart\.timeframe/)
  assert.match(prefetchBlock, /const data = await getStockDetail\(ticker\)/)
  assert.match(prefetchBlock, /deriveChartBarsFromDailySeed\(data\.bars, timeframe\)/)

  const deriveIndex = prefetchBlock.indexOf("deriveChartBarsFromDailySeed(data.bars, timeframe)")
  const remoteIndex = prefetchBlock.indexOf("prepareInitialChartHistory")
  assert.ok(
    deriveIndex >= 0 && remoteIndex > deriveIndex,
    "prefetch must prove Daily-seed usability before remote OHLCV preparation",
  )
})

test("QEO-172 ticker navigation uses fetched Daily seed before remote chart preparation while preserving 3D fallback", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  const navigationStart = workstation.indexOf("const handleSelectTicker")
  const navigationEnd = workstation.indexOf("useEffect(() => {", navigationStart)
  const navigation = workstation.slice(navigationStart, navigationEnd)

  assert.ok(navigationStart >= 0 && navigationEnd > navigationStart, "ticker navigation block must remain discoverable")
  assert.match(navigation, /const targetDataPromise = getStockDetail\(sym\)/)
  assert.match(navigation, /const targetPreparedPromise = targetTimeframe === "3D"/)
  assert.match(navigation, /const targetData = await targetDataPromise/)
  assert.match(navigation, /deriveChartBarsFromDailySeed\(targetData\.bars, targetTimeframe\)/)
  assert.match(navigation, /seededBars\.length > 0\s*\?\s*null/)
  assert.match(navigation, /targetPreparedPromise \?\? prepareInitialChartHistory/)
})
