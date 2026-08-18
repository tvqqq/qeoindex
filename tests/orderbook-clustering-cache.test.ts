import test from "node:test"
import assert from "node:assert/strict"

import { clusterTrades, parseTradeSeconds } from "../lib/trade-clustering.ts"

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
