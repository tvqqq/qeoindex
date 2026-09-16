import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 stock detail cold bootstrap stays ticker-scoped", () => {
  const stockDetail = source("modules/research/insights/stock-detail-data.ts")
  const runtime = source("modules/ai-council/runtime.ts")
  const councilData = source("modules/ai-council/data.ts")
  const research = source("modules/research/data.ts")

  assert.match(stockDetail, /getCachedResearchTickerData/)
  assert.match(stockDetail, /getCachedScannerTickerData/)
  assert.doesNotMatch(stockDetail, /\bgetCachedResearchData\(\)/)
  assert.doesNotMatch(stockDetail, /\bgetCachedScannerData\(\)/)
  assert.match(stockDetail, /getStockDetailCouncilRuntime\(supabase,\s*decoded\)/)

  assert.match(runtime, /tickers\?:\s*string\[\]/)
  assert.match(runtime, /tickers:\s*options\.tickers/)
  assert.match(councilData, /tickers\?:\s*string\[\]/)
  assert.match(councilData, /options\.tickers/)

  const loadTicker = research.match(/async function loadTicker\(ticker: string\)[\s\S]*?\n}\n\nfunction cacheConfig/)?.[0] ?? ""
  assert.ok(loadTicker, "loadTicker implementation must remain discoverable")
  assert.match(loadTicker, /filter:\s*\{\s*property:\s*"Ticker",\s*title:\s*\{\s*equals:/)
  assert.doesNotMatch(loadTicker, /await loadTheses\(\)/)
})
