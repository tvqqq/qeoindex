import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"
import type { LiveStockQuote } from "@/components/live-market-stock"

export interface RealtimeMarketTick {
  symbol: string
  price: number
  reference: number
  ceiling?: number
  floor?: number
  change?: number
  changePercent?: number
  volume?: number
  updatedAt?: string
}

export type RealtimeCallback = (tick: RealtimeMarketTick) => void

/**
 * Subscribes to Supabase Realtime Broadcast channel for live market ticks.
 * Returns unsubscribe function or null if Supabase is not configured.
 */
export function subscribeMarketRealtime(
  channelName: string = "market:top100",
  onTick: RealtimeCallback
): (() => void) | null {
  if (!isSupabaseConfigured()) return null

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const channel = supabase.channel(channelName, {
    config: {
      broadcast: { self: false },
    },
  })

  channel
    .on("broadcast", { event: "tick" }, ({ payload }) => {
      if (payload && typeof payload === "object" && "symbol" in payload) {
        onTick(payload as RealtimeMarketTick)
      }
    })
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "stock_orderbook_snapshots",
      },
      (payload) => {
        const row = payload.new as any
        if (row?.symbol && row?.latest_price) {
          onTick({
            symbol: row.symbol,
            price: Number(row.latest_price),
            reference: Number(row.reference_price ?? row.latest_price),
            ceiling: Number(row.ceiling_price ?? 0),
            floor: Number(row.floor_price ?? 0),
            volume: Number(row.total_volume ?? 0),
            updatedAt: row.updated_at,
          })
        }
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
