import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { clusterTrades, parseTradeSeconds } from "../modules/market/realtime/trade-clustering.ts"

test("parseTradeSeconds correctly parses and sorts trade time strings", () => {
  const times = ["09:15:00", "10:55:46", "09:30:15", "11:02:00"]
  const sorted = [...times].sort((a, b) => parseTradeSeconds(b) - parseTradeSeconds(a))

  assert.deepEqual(sorted, ["11:02:00", "10:55:46", "09:30:15", "09:15:00"], "Newest time must come first")
})

test("clusterTrades groups trades with same action occurring in the same second or <= 1s apart", () => {
  const trades = [
    { id: "t1", time: "10:15:21", price: 25.5, volume: 1000, side: "BUY" as const },
    { id: "t2", time: "10:15:21", price: 25.5, volume: 2000, side: "BUY" as const },
    { id: "t3", time: "10:15:20", price: 25.5, volume: 3000, side: "BUY" as const },
    { id: "t4", time: "10:15:20", price: 25.4, volume: 500, side: "SELL" as const },
    { id: "t5", time: "10:15:15", price: 25.3, volume: 800, side: "SELL" as const },
    { id: "t6", time: "10:15:14", price: 25.3, volume: 1200, side: "SELL" as const },
  ]

  const clustered = clusterTrades(trades)

  assert.equal(clustered.length, 3, "Should produce exactly 3 clustered trades")
  assert.equal(clustered[0].side, "BUY")
  assert.equal(clustered[0].volume, 6000)
  assert.equal(clustered[0].count, 3)
  assert.equal(clustered[0].price, 25.5)
  assert.equal(clustered[1].side, "SELL")
  assert.equal(clustered[1].volume, 500)
  assert.equal(clustered[1].count, 1)
  assert.equal(clustered[2].side, "SELL")
  assert.equal(clustered[2].volume, 2000)
  assert.equal(clustered[2].count, 2)
})

test("clusterTrades groups sweeping trades within <=1s with highest price for BUY and lowest for SELL", () => {
  const trades = [
    { id: "t1", time: "14:25:36", price: 66.7, volume: 28600, side: "BUY" as const },
    { id: "t2", time: "14:25:36", price: 66.8, volume: 11400, side: "BUY" as const },
    { id: "t3", time: "14:25:30", price: 66.5, volume: 5000, side: "SELL" as const },
    { id: "t4", time: "14:25:30", price: 66.4, volume: 15000, side: "SELL" as const },
  ]

  const clustered = clusterTrades(trades)
  assert.equal(clustered.length, 2)
  assert.equal(clustered[0].side, "BUY")
  assert.equal(clustered[0].volume, 40000)
  assert.equal(clustered[0].price, 66.8)
  assert.equal(clustered[0].count, 2)
  assert.equal(clustered[1].side, "SELL")
  assert.equal(clustered[1].volume, 20000)
  assert.equal(clustered[1].price, 66.4)
  assert.equal(clustered[1].count, 2)
})

test("clusterTrades never mixes Supabase snapshot volume into a DNSE live whale candidate", () => {
  const clustered = clusterTrades([
    {
      id: "history-vps-1",
      time: "09:49:59",
      price: 11.8,
      volume: 40_000,
      side: "SELL" as const,
      source: "SUPABASE_SNAPSHOT" as const,
    },
    {
      id: "live-dnse-1",
      time: "09:50:00",
      price: 11.8,
      volume: 20_000,
      side: "SELL" as const,
      source: "DNSE_LIVE" as const,
    },
  ])

  assert.equal(clustered.length, 2, "snapshot/history volume must never combine with a DNSE live whale candidate")
  assert.equal(clustered[0]?.source, "SUPABASE_SNAPSHOT")
  assert.equal(clustered[0]?.volume, 40_000)
  assert.equal(clustered[1]?.source, "DNSE_LIVE")
  assert.equal(clustered[1]?.volume, 20_000)
})

test("clusterTrades still combines consecutive DNSE live executions", () => {
  const clustered = clusterTrades([
    {
      id: "live-dnse-1",
      time: "09:50:00",
      price: 11.8,
      volume: 20_000,
      side: "BUY" as const,
      source: "DNSE_LIVE" as const,
    },
    {
      id: "live-dnse-2",
      time: "09:50:01",
      price: 11.85,
      volume: 40_000,
      side: "BUY" as const,
      source: "DNSE_LIVE" as const,
    },
  ])

  assert.equal(clustered.length, 1)
  assert.equal(clustered[0]?.source, "DNSE_LIVE")
  assert.equal(clustered[0]?.volume, 60_000)
  assert.equal(clustered[0]?.price, 11.85)
  assert.equal(clustered[0]?.count, 2)
})

test("orderbook realtime behavior is explicitly gated to DNSE live provenance", () => {
  const source = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")

  assert.match(source, /source:\s*"DNSE_LIVE"/, "DNSE tick_extra trades must carry live provenance")
  assert.match(
    source,
    /payload\.provider === "DNSE" \? "DNSE_HISTORY" : "SUPABASE_SNAPSHOT"/,
    "REST hydration must preserve whether it came from DNSE or snapshot fallback",
  )
  assert.match(
    source,
    /parseRawTrades\(direct\.trades, "SUPABASE_SNAPSHOT"\)/,
    "direct Supabase hydration must be tagged as snapshot data",
  )
  assert.match(
    source,
    /clusteredTrades\.filter\(\(t\) => t\.source === "DNSE_LIVE"\)/,
    "whale alert candidates must be filtered to DNSE live clusters",
  )
  assert.match(
    source,
    /if \(state === "LIVE"\) return/,
    "5-minute Supabase/VPS refreshes must not overwrite a healthy DNSE live orderbook",
  )
  assert.match(
    source,
    /for \(const t of realtimeWhaleTrades\)/,
    "confetti/sound/glow evaluation must iterate only DNSE live candidates",
  )
})

test("DNSE live trades use stable provider identity instead of random ids", () => {
  const source = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")
  const liveTradeBlock = source.match(
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
  const source = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")
  const wsBlock = source.match(
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

test("calculateSessionCountdown handles ATO (09:00 - 09:15) and ATC (14:30 - 14:45) exact boundaries", async () => {
  const { calculateSessionCountdown } = await import("../modules/market/realtime/session-countdown.ts")

  const dAtoStart = new Date("2026-08-17T02:00:00.000Z")
  const atoStartRes = calculateSessionCountdown(dAtoStart)
  assert.deepEqual(atoStartRes, { type: "ATO", label: "15:00", remainingSec: 900 })

  const dAtoMid = new Date("2026-08-17T02:10:30.000Z")
  const atoMidRes = calculateSessionCountdown(dAtoMid)
  assert.deepEqual(atoMidRes, { type: "ATO", label: "04:30", remainingSec: 270 })

  const dAtoLast = new Date("2026-08-17T02:14:59.000Z")
  const atoLastRes = calculateSessionCountdown(dAtoLast)
  assert.deepEqual(atoLastRes, { type: "ATO", label: "00:01", remainingSec: 1 })

  const dAtoEnd = new Date("2026-08-17T02:15:00.000Z")
  assert.equal(calculateSessionCountdown(dAtoEnd), null)

  const dLunch = new Date("2026-08-17T04:30:00.000Z")
  assert.equal(calculateSessionCountdown(dLunch), null)

  const dAtcStart = new Date("2026-08-17T07:30:00.000Z")
  const atcStartRes = calculateSessionCountdown(dAtcStart)
  assert.deepEqual(atcStartRes, { type: "ATC", label: "15:00", remainingSec: 900 })

  const dAtcLast = new Date("2026-08-17T07:44:59.000Z")
  const dAtcLastRes = calculateSessionCountdown(dAtcLast)
  assert.deepEqual(dAtcLastRes, { type: "ATC", label: "00:01", remainingSec: 1 })

  const dAtcEnd = new Date("2026-08-17T07:45:00.000Z")
  assert.equal(calculateSessionCountdown(dAtcEnd), null)

  const dSunday = new Date("2026-08-16T02:05:00.000Z")
  assert.equal(calculateSessionCountdown(dSunday), null)
})
