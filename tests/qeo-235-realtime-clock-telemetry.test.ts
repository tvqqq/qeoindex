import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const orderbookStream = readFileSync(
  new URL("../modules/market/providers/dnse/orderbook-stream.ts", import.meta.url),
  "utf8",
)

test("QEO-235 uses DNSE multicast receive time for provider-to-worker latency", () => {
  assert.match(
    orderbookStream,
    /timestampValueMs\(frame\.multicastReceiveTime \?\? frame\.time/,
    "provider latency must prefer DNSE multicastReceiveTime before exchange/event time",
  )
})

test("QEO-235 clears latency samples across relay continuity boundaries", () => {
  assert.match(orderbookStream, /const resetLatencySamples = \(\) =>/)
  assert.match(orderbookStream, /latencySamples\.splice\(0, latencySamples\.length\)/)
  assert.match(orderbookStream, /latencyFrameCount = 0/)
  assert.match(orderbookStream, /nextLatencyReportAt = LATENCY_REPORT_EVERY/)

  const resetBaseline = orderbookStream.match(
    /const resetLiveBaseline = \(\) => \{[\s\S]*?\n  \}/,
  )?.[0] ?? ""
  assert.match(
    resetBaseline,
    /resetLatencySamples\(\)/,
    "a worker epoch/recovery boundary must not mix latency samples from the previous epoch",
  )
})
