import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { normalizeFinhayIndexBreadth, normalizeFinhayIndexQuote } from "../modules/market/providers/finhay/live.ts"

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

test("Finhay market breadth normalizes full VNINDEX/VN30 membership, including zero, with provider as-of", () => {
  const raw = {
    window: "1D",
    updated_at: "2026-10-06T09:19:05+07:00",
    items: [
      { index: "VNINDEX", advancers: 123, decliners: 95, unchanged: 68, constituent_count: 406 },
      { index: "VN30", advancers: 14, decliners: 15, unchanged: 1, constituent_count: 30 },
    ],
  }
  assert.deepEqual(normalizeFinhayIndexBreadth(raw, "VNINDEX"), {
    symbol: "VNINDEX", advances: 123, declines: 95, unchanged: 68, sourceUpdatedAt: raw.updated_at,
  })
  assert.deepEqual(normalizeFinhayIndexBreadth(raw, "VN30"), {
    symbol: "VN30", advances: 14, declines: 15, unchanged: 1, sourceUpdatedAt: raw.updated_at,
  })
  assert.equal(normalizeFinhayIndexBreadth({ ...raw, items: [{ index: "VN30", advancers: 0, decliners: 0, unchanged: 0 }] }, "VN30")?.unchanged, 0)
  assert.equal(normalizeFinhayIndexBreadth({ ...raw, items: [{ index: "VN30", advancers: 10, decliners: 10 }] }, "VN30"), null)
  assert.equal(normalizeFinhayIndexBreadth({ ...raw, updated_at: "" }, "VN30"), null)
  assert.equal(normalizeFinhayIndexBreadth(raw, "HNXINDEX"), null)
  assert.ok(liveSource.includes('index,volume,trading_value,constituent_count,advancers,decliners,unchanged'))
  assert.ok(liveSource.includes('normalizeFinhayIndexBreadth(liquidityRaw, "VN30")'))
})

test("Finhay quote route preserves index requests through the normalized adapter", () => {
  assert.match(quoteRouteSource, /searchParams\.get\("indexes"\)/)
  assert.match(quoteRouteSource, /getFinhayIndexQuote\(accessToken, symbol\)/)
  assert.match(quoteRouteSource, /quotes\[symbol\] = result\.value/)
})
