import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const streamSource = readFileSync(new URL("../services/market-realtime-worker/internal/dnse/stream.go", import.meta.url), "utf8")
const bufferSource = readFileSync(new URL("../services/market-realtime-worker/internal/realtime/orderbook_buffer.go", import.meta.url), "utf8")
const workerSource = readFileSync(new URL("../services/market-realtime-worker/internal/worker/run.go", import.meta.url), "utf8")
const panelSource = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")

test("QEO-222 routes DNSE auction expected-price state through the centralized orderbook fanout", () => {
  assert.match(streamSource, /expected_price\.G1\.json/)
  assert.match(bufferSource, /typ != "e"/)
  assert.match(workerSource, /len\(symbols\)\s*\*\s*4/)
})

test("QEO-222 renders auction expected match price and quantity without replacing the last matched quote", () => {
  const expectedPriceBlock = panelSource.match(/if \(data\?\.T === "e"\)[\s\S]*?return\n\s*}/)?.[0] ?? ""

  assert.ok(expectedPriceBlock, "expected a dedicated DNSE expected-price reducer")
  assert.match(expectedPriceBlock, /expectedTradePrice/)
  assert.match(expectedPriceBlock, /expectedTradeQuantity/)
  assert.match(expectedPriceBlock, /setAuctionExpected/)
  assert.doesNotMatch(
    expectedPriceBlock,
    /setQuote\(/,
    "indicative ATO\/ATC price must not overwrite the actual matched quote/header price",
  )

  assert.match(panelSource, /setAuctionExpected\(null\)/, "session reset must clear stale auction indication")
  assert.match(panelSource, /Dự khớp/)
  assert.match(panelSource, /KL dự khớp/)
})
