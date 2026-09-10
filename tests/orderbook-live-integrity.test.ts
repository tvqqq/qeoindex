import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const orderbookSource = readFileSync(
  new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url),
  "utf8",
)

test("DNSE live trades use stable provider identity instead of random ids", () => {
  const liveTradeBlock = orderbookSource.match(
    /\/\/ Tick extra trade execution[\s\S]*?setTrades\(\(current\) => mergeTrades\(\[trade\], current\)\)/,
  )?.[0] ?? ""

  assert.ok(liveTradeBlock, "expected to find the DNSE tick_extra trade block")
  assert.doesNotMatch(
    liveTradeBlock,
    /Math\.random/,
    "a replayed DNSE execution must generate the same trade id so mergeTrades can dedupe it",
  )
  assert.match(
    liveTradeBlock,
    /transId|tradeId|sequence|seqNo|sID/,
    "live trade identity should prefer a provider supplied execution/sequence id",
  )
})

test("orderbook websocket ignores stale connection attempts and stale socket callbacks", () => {
  const wsBlock = orderbookSource.match(
    /\/\/ WebSocket Live Stream[\s\S]*?\}, \[symbol, reconnectKey\]\)/,
  )?.[0] ?? ""

  assert.ok(wsBlock, "expected to find the orderbook websocket effect")
  assert.match(wsBlock, /let connectionGeneration = 0/)
  assert.match(wsBlock, /const generation = \+\+connectionGeneration/)
  assert.match(
    wsBlock,
    /disposed \|\| generation !== connectionGeneration/,
    "an auth response from an obsolete connect() attempt must not create another socket",
  )
  assert.match(wsBlock, /const nextSocket = new WebSocket\(/)
  assert.match(
    wsBlock,
    /socket !== nextSocket/,
    "callbacks from an obsolete socket must not mutate orderbook state or schedule reconnects",
  )
})
