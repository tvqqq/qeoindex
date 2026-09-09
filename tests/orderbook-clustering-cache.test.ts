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
    // Cluster 1: 3 BUY trades within 1s
    { id: "t1", time: "10:15:21", price: 25.5, volume: 1000, side: "BUY" as const },
    { id: "t2", time: "10:15:21", price: 25.5, volume: 2000, side: "BUY" as const },
    { id: "t3", time: "10:15:20", price: 25.5, volume: 3000, side: "BUY" as const },
    // Cluster 2: 1 SELL trade at 10:15:20 (different side)
    { id: "t4", time: "10:15:20", price: 25.4, volume: 500, side: "SELL" as const },
    // Cluster 3: 2 SELL trades at 10:15:15 (gap > 1s from 10:15:20)
    { id: "t5", time: "10:15:15", price: 25.3, volume: 800, side: "SELL" as const },
    { id: "t6", time: "10:15:14", price: 25.3, volume: 1200, side: "SELL" as const },
  ]

  const clustered = clusterTrades(trades)

  assert.equal(clustered.length, 3, "Should produce exactly 3 clustered trades")

  // Check Cluster 1 (BUY 1000 + 2000 + 3000 = 6000)
  assert.equal(clustered[0].side, "BUY")
  assert.equal(clustered[0].volume, 6000)
  assert.equal(clustered[0].count, 3)
  assert.equal(clustered[0].price, 25.5)

  // Check Cluster 2 (SELL 500)
  assert.equal(clustered[1].side, "SELL")
  assert.equal(clustered[1].volume, 500)
  assert.equal(clustered[1].count, 1)

  // Check Cluster 3 (SELL 800 + 1200 = 2000)
  assert.equal(clustered[2].side, "SELL")
  assert.equal(clustered[2].volume, 2000)
  assert.equal(clustered[2].count, 2)
})

test("clusterTrades groups sweeping trades within <=1s with highest price for BUY and lowest for SELL", () => {
  const trades = [
    // Aggressive buy order sweeping 66.7 and 66.8 at 14:25:36
    { id: "t1", time: "14:25:36", price: 66.7, volume: 28600, side: "BUY" as const },
    { id: "t2", time: "14:25:36", price: 66.8, volume: 11400, side: "BUY" as const },
    // Aggressive sell order sweeping 66.5 and 66.4 at 14:25:30
    { id: "t3", time: "14:25:30", price: 66.5, volume: 5000, side: "SELL" as const },
    { id: "t4", time: "14:25:30", price: 66.4, volume: 15000, side: "SELL" as const },
  ]

  const clustered = clusterTrades(trades)
  assert.equal(clustered.length, 2)
  // Cluster 1 (BUY): 28.600 + 11.400 = 40.000, highest price = 66.8
  assert.equal(clustered[0].side, "BUY")
  assert.equal(clustered[0].volume, 40000)
  assert.equal(clustered[0].price, 66.8)
  assert.equal(clustered[0].count, 2)

  // Cluster 2 (SELL): 5.000 + 15.000 = 20.000, lowest price = 66.4
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

test("calculateSessionCountdown handles ATO (09:00 - 09:15) and ATC (14:30 - 14:45) exact boundaries", async () => {
  const { calculateSessionCountdown } = await import("../modules/market/realtime/session-countdown.ts")

  // Monday: 2026-08-17 (UTC 02:00:00 = VN 09:00:00)
  const dAtoStart = new Date("2026-08-17T02:00:00.000Z") // VN 09:00:00
  const atoStartRes = calculateSessionCountdown(dAtoStart)
  assert.deepEqual(atoStartRes, { type: "ATO", label: "15:00", remainingSec: 900 })

  // Monday: VN 09:10:30 (UTC 02:10:30) -> 04:30 remaining
  const dAtoMid = new Date("2026-08-17T02:10:30.000Z")
  const atoMidRes = calculateSessionCountdown(dAtoMid)
  assert.deepEqual(atoMidRes, { type: "ATO", label: "04:30", remainingSec: 270 })

  // Monday: VN 09:14:59 (UTC 02:14:59) -> 00:01 remaining
  const dAtoLast = new Date("2026-08-17T02:14:59.000Z")
  const atoLastRes = calculateSessionCountdown(dAtoLast)
  assert.deepEqual(atoLastRes, { type: "ATO", label: "00:01", remainingSec: 1 })

  // Monday: VN 09:15:00 (UTC 02:15:00) -> ATO ended, returns null
  const dAtoEnd = new Date("2026-08-17T02:15:00.000Z")
  assert.equal(calculateSessionCountdown(dAtoEnd), null)

  // Monday: VN 11:30:00 (lunch break) -> returns null
  const dLunch = new Date("2026-08-17T04:30:00.000Z")
  assert.equal(calculateSessionCountdown(dLunch), null)

  // Monday: VN 14:30:00 (UTC 07:30:00) -> ATC starts (15:00 remaining)
  const dAtcStart = new Date("2026-08-17T07:30:00.000Z")
  const atcStartRes = calculateSessionCountdown(dAtcStart)
  assert.deepEqual(atcStartRes, { type: "ATC", label: "15:00", remainingSec: 900 })

  // Monday: VN 14:44:59 (UTC 07:44:59) -> ATC 00:01 remaining
  const dAtcLast = new Date("2026-08-17T07:44:59.000Z")
  const atcLastRes = calculateSessionCountdown(dAtcLast)
  assert.deepEqual(atcLastRes, { type: "ATC", label: "00:01", remainingSec: 1 })

  // Monday: VN 14:45:00 (UTC 07:45:00) -> ATC ended, returns null
  const dAtcEnd = new Date("2026-08-17T07:45:00.000Z")
  assert.equal(calculateSessionCountdown(dAtcEnd), null)

  // Sunday: VN 09:05:00 (Weekend) -> returns null
  const dSunday = new Date("2026-08-16T02:05:00.000Z")
  assert.equal(calculateSessionCountdown(dSunday), null)
})
