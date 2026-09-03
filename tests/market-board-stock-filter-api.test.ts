import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const preferenceRoute = readFileSync(new URL("../app/api/me/market-board-filter/route.ts", import.meta.url), "utf8")
const quoteRoute = readFileSync(new URL("../app/api/market/quotes/route.ts", import.meta.url), "utf8")

test("market board filter preference route is authenticated and merges settings safely", () => {
  assert.match(preferenceRoute, /requireApiUser\(\)/)
  assert.match(preferenceRoute, /getCanonicalUniverse\(\)/)
  assert.match(preferenceRoute, /readStockFilterFromSettings/)
  assert.match(preferenceRoute, /mergeStockFilterIntoSettings/)
  assert.match(preferenceRoute, /16 \* 1024/)
  assert.match(preferenceRoute, /Buffer\.byteLength\(encodedSettings, "utf8"\)/)
  assert.match(preferenceRoute, /\.from\("user_preferences"\)/)
  assert.match(preferenceRoute, /\.eq\("user_id", userId\)/)
  assert.match(preferenceRoute, /upsert\(\{ user_id: userId, settings: mergedSettings \}/)
  assert.match(preferenceRoute, /"Cache-Control": "no-store, max-age=0"/)
})

test("market quote reconcile route is authenticated, canonical-bounded, and batch-only", () => {
  assert.match(quoteRoute, /requireApiUser\(\)/)
  assert.match(quoteRoute, /getCanonicalUniverse\(\)/)
  assert.match(quoteRoute, /MARKET_UNIVERSE_MAX_SIZE/)
  assert.match(quoteRoute, /new Set\(canonical\.stocks\.map\(\(stock\) => stock\.ticker\)\)/)
  assert.match(quoteRoute, /fetchLiveBatchQuotes\(symbols\)/)
  assert.doesNotMatch(quoteRoute, /for \([\s\S]*fetchLiveBatchQuotes/)
  assert.match(quoteRoute, /"Cache-Control": "no-store, max-age=0"/)
})
