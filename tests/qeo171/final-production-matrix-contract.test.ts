import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const spec = readFileSync("tests/browser/qeo171-stock-chart-production.spec.ts", "utf8")
const chart = readFileSync("components/stock-detail/stock-tradingview-chart.tsx", "utf8")

test("QEO-171 production harness covers the remaining visual/data acceptance matrix", () => {
  assert.match(spec, /assertMacdPresentation/)
  assert.match(spec, /assertVolumeProfileAxisClearance/)
  assert.match(spec, /assertCrosshairTimestampConsistency/)
  assert.match(spec, /assertDrawingSurvivesViewportChanges/)

  // These helpers must be exercised in the real authenticated browser flow,
  // not merely declared as dead test utilities.
  assert.match(spec, /await assertMacdPresentation\(/)
  assert.match(spec, /await assertVolumeProfileAxisClearance\(/)
  assert.match(spec, /await assertCrosshairTimestampConsistency\(/)
  assert.match(spec, /await assertDrawingSurvivesViewportChanges\(/)
})

test("QEO-171 chart exposes deterministic semantics needed by production acceptance", () => {
  // MACD must have an explicit zero baseline in addition to sign-colored histogram bars.
  assert.match(chart, /macdZero:\s*LightweightSeriesApi/)
  assert.match(chart, /title:\s*"MACD 0"/)
  assert.match(chart, /macdZero:\s*constantLineData\(0, barTimes\)/)
  assert.match(chart, /value\s*>=\s*0\s*\?\s*`rgba\(34,197,94/)
  assert.match(chart, /`rgba\(239,68,68/)

  // Runtime QA reads the same active timestamp used for OHLCV + indicator legends,
  // and measures volume-profile clearance against the live right price scale width.
  assert.match(chart, /data-chart-legend-time=\{legendTime\s*\?\?\s*""\}/)
  assert.match(chart, /data-chart-active-bar-time=\{activeBar\?\.time\s*\?\?\s*""\}/)
  assert.match(chart, /data-chart-price-axis-gutter=\{priceAxisGutter\}/)
  assert.match(chart, /getRightPriceScale\?\.\(\)\.width\?\.\(\)/)
  assert.match(chart, /profileRight\s*=\s*Math\.max\(0, width - priceAxisGutter\)/)
})
