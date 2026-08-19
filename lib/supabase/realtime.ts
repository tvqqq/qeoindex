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
 * Subscribes to Supabase Realtime market ticks.
 *
 * Broadcast and Postgres changes can produce several updates for the same symbol
 * during a single browser frame. Coalesce them here so consumers never receive
 * more than one callback per symbol per animation frame.
 */
export function subscribeMarketRealtime(
  channelName: string = "market:top100",
  onTick: RealtimeCallback
): (() => void) | null {
  if (!isSupabaseConfigured()) return null

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  const pending = new Map<string, RealtimeMarketTick>()
  let frame: number | null = null
  let disposed = false

  const flush = () => {
    frame = null
    if (disposed) return
    const ticks = Array.from(pending.values())
    pending.clear()
    for (const tick of ticks) onTick(tick)
  }

  const enqueue = (tick: RealtimeMarketTick) => {
    if (disposed || !tick.symbol) return
    pending.set(tick.symbol.toUpperCase(), tick)
    if (frame === null && typeof window !== "undefined") {
      frame = window.requestAnimationFrame(flush)
    }
  }

  const handlePayload = (payload: unknown) => {
    if (payload && typeof payload === "object" && "symbol" in payload) {
      enqueue(payload as RealtimeMarketTick)
    }
  }

  const channel = supabase.channel(channelName, {
    config: {
      broadcast: { self: false },
    },
  })

  channel
    .on("broadcast", { event: "tick" }, ({ payload }) => {
      handlePayload(payload)
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
          enqueue({
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
    disposed = true
    if (frame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(frame)
    }
    frame = null
    pending.clear()
    void supabase.removeChannel(channel)
  }
}
