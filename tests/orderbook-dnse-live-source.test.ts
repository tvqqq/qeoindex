import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { clusterTrades } from "../modules/market/realtime/trade-clustering.ts"

test("clusterTrades keeps DNSE live executions isolated from snapshot/history trades", () => {
  const trades = [
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
  ]

  const clustered = clusterTrades(trades)

  assert.equal(clustered.length, 2, "snapshot/history volume must never combine with a DNSE live whale candidate")
  assert.equal(clustered[0]?.source, "SUPABASE_SNAPSHOT")
  assert.equal(clustered[1]?.source, "DNSE_LIVE")
})

test("orderbook whale animation is explicitly gated to DNSE live trade provenance", () => {
  const source = readFileSync(new URL("../components/orderbook/live-orderbook-panel.tsx", import.meta.url), "utf8")

  assert.match(source, /source:\s*"DNSE_LIVE"/, "DNSE tick_extra trades must carry live provenance")
  assert.match(source, /source:\s*"DNSE_HISTORY"/, "DNSE REST hydration must be tagged as history")
  assert.match(source, /source:\s*"SUPABASE_SNAPSHOT"/, "Supabase\/VPS snapshots must be tagged as snapshot data")
  assert.match(
    source,
    /clusteredTrades\.filter\(\(t\) => t\.source === "DNSE_LIVE"\)/,
    "whale alert candidates must be filtered to DNSE live clusters",
  )
})
