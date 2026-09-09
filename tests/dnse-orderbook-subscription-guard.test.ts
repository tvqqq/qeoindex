import test from "node:test"
import assert from "node:assert/strict"
import { rewriteDnseBoardSubscriptionMessage } from "../modules/market/board/dnse-subscriptions.ts"

test("DNSE board budget guard leaves popup orderbook subscription untouched", () => {
  const symbol = "VCB"
  const orderbook = JSON.stringify({
    action: "subscribe",
    channels: [
      { name: "tick.G1.json", symbols: [symbol] },
      { name: "top_price.G1.json", symbols: [symbol] },
      { name: "tick_extra.G1.json", symbols: [symbol] },
      { name: "ohlc.1.json", symbols: [symbol] },
      { name: "foreign.G1.json", symbols: [symbol] },
    ],
  })

  assert.equal(rewriteDnseBoardSubscriptionMessage(orderbook), orderbook)
})
