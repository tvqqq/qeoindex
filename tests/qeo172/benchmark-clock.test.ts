import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 timed timeframe samples use the rendered-key mutation timestamp instead of assertion polling", () => {
  const benchmark = source("tests/browser/qeo172-chart-performance-production.spec.ts")

  assert.match(
    benchmark,
    /async function armRenderedTimestamp\(/,
    "benchmark must arm a rendered-key observer before the timed click",
  )
  assert.match(
    benchmark,
    /new MutationObserver\(/,
    "render timing must be captured at the DOM mutation, not at the next Playwright assertion poll",
  )

  const measureStart = benchmark.indexOf("async function measureTimeframeInteraction")
  const measureEnd = benchmark.indexOf("async function adjacentIntent", measureStart)
  const measureBlock = benchmark.slice(measureStart, measureEnd)

  assert.ok(measureStart >= 0 && measureEnd > measureStart, "timeframe measurement block must remain discoverable")
  assert.match(measureBlock, /await armRenderedTimestamp\(page, ticker, target\)/)
  assert.match(measureBlock, /const renderedAt = await readRenderedTimestamp\(page\)/)
  assert.match(measureBlock, /interactionMs: Math\.max\(0, renderedAt - startedAt\)/)
  assert.match(measureBlock, /renderAfterNetworkMs: lastNetworkFinishedAt >= startedAt\s*\? Math\.max\(0, renderedAt - lastNetworkFinishedAt\)/)
  assert.doesNotMatch(
    measureBlock,
    /const endedAt = Date\.now\(\)/,
    "timed samples must not use the post-assertion wall clock as the render completion timestamp",
  )
})

test("QEO-172 timeframe timing ignores unrelated adjacent OHLCV prefetch responses", () => {
  const benchmark = source("tests/browser/qeo172-chart-performance-production.spec.ts")
  const measureStart = benchmark.indexOf("async function measureTimeframeInteraction")
  const measureEnd = benchmark.indexOf("async function adjacentIntent", measureStart)
  const measureBlock = benchmark.slice(measureStart, measureEnd)

  assert.ok(measureStart >= 0 && measureEnd > measureStart, "timeframe measurement block must remain discoverable")
  assert.match(measureBlock, /const responseUrl = new URL\(response\.url\(\)\)/)
  assert.match(measureBlock, /responseUrl\.pathname !== "\/api\/market\/ohlcv"/)
  assert.match(measureBlock, /responseUrl\.searchParams\.get\("ticker"\)\?\.toUpperCase\(\) !== ticker/)
  assert.match(measureBlock, /responseUrl\.searchParams\.get\("resolution"\) !== target/)
})
