import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { clusterTrades } from "../modules/market/realtime/trade-clustering.ts"

test("clusterTrades keeps DNSE live executions isolated from snapshot/history trades", () => {
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
