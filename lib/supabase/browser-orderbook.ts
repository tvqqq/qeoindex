import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"
import type { DnseSessionHistory } from "@/lib/dnse-market-runtime"

export async function fetchOrderbookFromSupabaseDirect(symbol: string): Promise<DnseSessionHistory | null> {
  if (!isSupabaseConfigured()) return null

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return null

  try {
    const { data, error } = await supabase
      .from("stock_orderbook_snapshots")
      .select("*")
      .eq("symbol", symbol.toUpperCase())
      .single()

    if (error || !data) return null

    const sessionStart = data.intraday_1m?.[0] ? Number(data.intraday_1m[0].time) : Math.floor(Date.now() / 1000)

    return {
      symbol: data.symbol,
      sessionStart,
      generatedAt: data.updated_at,
      prices: Array.isArray(data.intraday_1m) ? data.intraday_1m : [],
      trades: Array.isArray(data.trades) ? data.trades : [],
      tradesTruncated: Boolean(data.trades_truncated),
      latestQuote: data.latest_quote ?? null,
      foreign: data.foreign_flow ?? null,
      putThrough: Array.isArray(data.put_through) ? data.put_through : [],
    }
  } catch (err) {
    console.warn(`[Supabase Browser] Failed to direct query ${symbol}:`, err)
    return null
  }
}

export function subscribeToOrderbookRealtime(
  symbol: string,
  onSnapshot: (snapshot: DnseSessionHistory) => void
): () => void {
  if (!isSupabaseConfigured()) return () => {}

  const supabase = getSupabaseBrowserClient()
  if (!supabase) return () => {}

  const upper = symbol.toUpperCase()
  const channelName = `orderbook-${upper}-${Math.random().toString(36).slice(2, 7)}`

  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "stock_orderbook_snapshots",
        filter: `symbol=eq.${upper}`,
      },
      (payload) => {
        const row = (payload.new || payload.old) as any
        if (!row || !row.symbol) return

        const sessionStart = row.intraday_1m?.[0] ? Number(row.intraday_1m[0].time) : Math.floor(Date.now() / 1000)
        onSnapshot({
          symbol: row.symbol,
          sessionStart,
          generatedAt: row.updated_at,
          prices: Array.isArray(row.intraday_1m) ? row.intraday_1m : [],
          trades: Array.isArray(row.trades) ? row.trades : [],
          tradesTruncated: Boolean(row.trades_truncated),
          latestQuote: row.latest_quote ?? null,
          foreign: row.foreign_flow ?? null,
          putThrough: Array.isArray(row.put_through) ? row.put_through : [],
        })
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
