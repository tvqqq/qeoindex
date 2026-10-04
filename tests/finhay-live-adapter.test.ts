import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { normalizeFinhayIndexQuote } from "../modules/market/providers/finhay/live.ts"

const liveSource = readFileSync(new URL("../modules/market/providers/finhay/live.ts", import.meta.url), "utf8")
const quoteRouteSource = readFileSync(new URL("../app/api/finhay/quote/route.ts", import.meta.url), "utf8")

test("Finhay index quote uses the current MCP symbol argument contract", () => {
  assert.match(liveSource, /callFinhayTool\(accessToken, "get_index_quote", \{ symbol \}\)/)
  assert.doesNotMatch(liveSource, /get_index_quote", \{ index:/)
})

test("Finhay index quote normalizes the current runtime response shape", () => {
  const quote = normalizeFinhayIndexQuote({
    symbol: "VNINDEX",
    name: "VN-Index",
    value: 1737.71,
    change: -11.59,
    change_percent: -0.66,
    updated_at: "2026-10-02T22:05:05+07:00",
  }, "VNINDEX")

  assert.deepEqual(quote, {
    symbol: "VNINDEX",
    value: 1737.71,
    change: -11.59,
    changePercent: -0.66,
    updatedAt: "2026-10-02T22:05:05+07:00",
  })
})

test("Finhay quote route preserves index requests through the normalized adapter", () => {
  assert.match(quoteRouteSource, /searchParams\.get\("indexes"\)/)
  assert.match(quoteRouteSource, /getFinhayIndexQuote\(accessToken, symbol\)/)
  assert.match(quoteRouteSource, /quotes\[symbol\] = result\.value/)
})
