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

test("market quote reconcile route is authenticated, canonical-bounded, and uses bounded fallbacks", () => {
  assert.match(quoteRoute, /requireApiUser\(\)/)
  assert.match(quoteRoute, /getCanonicalUniverse\(\)/)
  assert.match(quoteRoute, /MARKET_UNIVERSE_MAX_SIZE/)
  assert.match(quoteRoute, /new Set\(canonical\.stocks\.map\(\(stock\) => stock\.ticker\)\)/)
  assert.match(quoteRoute, /fetchLiveBatchQuotes\(symbols\)/)
  assert.match(quoteRoute, /getCanonicalBoardOverviewSnapshots\(symbols\)/)
  assert.match(quoteRoute, /Promise\.all/)
  assert.doesNotMatch(quoteRoute, /for \([\s\S]*fetchLiveBatchQuotes/)
  assert.match(quoteRoute, /missingSymbols/)
  assert.match(quoteRoute, /Unable to reconcile all requested market quotes/)
  assert.match(quoteRoute, /"Cache-Control": "no-store, max-age=0"/)
})
