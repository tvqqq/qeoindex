import { readFileSync, writeFileSync } from "node:fs"

const path = "tests/market-board-visual-contract.test.ts"
let source = readFileSync(path, "utf8")

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText)
  const last = source.lastIndexOf(oldText)
  if (first < 0 || first !== last) {
    throw new Error(`${label}: expected exactly one source anchor`)
  }
  source = source.slice(0, first) + newText + source.slice(first + oldText.length)
}

replaceOnce(
`test("DNSE websocket messages use animation-frame buffering without retaining closures", () => {
  assert.match(boardSource, /let messageQueue: string\\[\\] = \\[\\]/)
  assert.match(boardSource, /window\\.requestAnimationFrame\\(flushMessageQueue\\)/)
  assert.match(boardSource, /window\\.cancelAnimationFrame\\(messageFrame\\)/)
  assert.match(boardSource, /socket\\.onmessage = \\(event\\) =>[\\s\\S]*?scheduleMessage\\(event\\.data\\)/)
  assert.match(boardSource, /for \\(const raw of queued\\)/)
  assert.match(boardSource, /clearMessageQueue\\(\\)[\\s\\S]*?socket\\.close\\(1000, "board closed"\\)/)
})`,
`test("Supabase realtime frames use animation-frame buffering without retaining closures", () => {
  assert.match(boardSource, /let messageQueue: string\\[\\] = \\[\\]/)
  assert.match(boardSource, /window\\.requestAnimationFrame\\(flushMessageQueue\\)/)
  assert.match(boardSource, /window\\.cancelAnimationFrame\\(messageFrame\\)/)
  assert.match(boardSource, /subscribeDnseMarketFrames\\(\\(frame\\) =>[\\s\\S]*?scheduleMessage\\(JSON\\.stringify\\(frame\\)\\)/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.match(boardSource, /for \\(const raw of queued\\)/)
  assert.match(boardSource, /clearMessageQueue\\(\\)[\\s\\S]*?unsubscribeFrames\\(\\)[\\s\\S]*?unsubscribeState\\(\\)/)
  assert.doesNotMatch(boardSource, /socket\\.onmessage/)
})`,
"realtime buffering contract",
)

const oldTransportStart = 'test("DNSE board transport rewrites legacy multi-feed subscription and preserves tick-driven mini charts", () => {'
const start = source.indexOf(oldTransportStart)
if (start < 0 || source.indexOf(oldTransportStart, start + 1) >= 0) throw new Error("legacy transport contract anchor missing or ambiguous")
const end = source.indexOf("\n})", start)
if (end < 0) throw new Error("legacy transport contract end missing")
const oldBlock = source.slice(start, end + 3)

const newBlock = `test("central realtime bus preserves the provider budget and tick-driven mini charts", () => {
  const symbols = Array.from({ length: 200 }, (_, index) => \`S\${String(index + 1).padStart(3, "0")}\`)
  const legacy = JSON.stringify({
    action: "subscribe",
    channels: [
      { name: "tick.G1.json", symbols },
      { name: "top_price.G1.json", symbols },
      { name: "ohlc.1.json", symbols: [...symbols, "VN30F1M"] },
      { name: "foreign.G1.json", symbols },
      { name: "market_index.VNINDEX.json" },
      { name: "market_index.VN30.json" },
      { name: "market_index.HNX.json" },
      { name: "market_index.UPCOM.json" },
    ],
  })
  const rewritten = rewriteDnseBoardSubscriptionMessage(legacy)
  assert.equal(typeof rewritten, "string")
  const parsed = JSON.parse(String(rewritten)) as { channels: Array<{ name: string; symbols?: string[] }> }
  assert.deepEqual(parsed.channels, [{ name: "tick.G1.json", symbols }])

  const synthetic = synthesizeDnseOhlcFromTickMessage(JSON.stringify({ T: "t", symbol: "VCB", matchPrice: 61_500, time: 1_788_921_000 }))
  assert.ok(synthetic)
  assert.deepEqual(JSON.parse(synthetic!), { T: "b", symbol: "VCB", matchPrice: 61_500, time: 1_788_921_000, close: 61_500 })

  assert.match(boardSource, /subscribeDnseMarketFrames/)
  assert.match(boardSource, /subscribeDnseMarketStreamState/)
  assert.doesNotMatch(boardSource, /new WebSocket\\(/)
  assert.doesNotMatch(boardSource, /\\/api\\/market\\/stream-auth/)
  assert.match(marketStreamSource, /market_realtime_bus/)
  assert.match(marketStreamSource, /postgres_changes/)
  assert.match(marketStreamSource, /synthesizeDnseOhlcFromTickMessage/)
})`

source = source.slice(0, start) + newBlock + source.slice(end + 3)
writeFileSync(path, source)
