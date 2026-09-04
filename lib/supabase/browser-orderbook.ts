import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client"
import type { DnseSessionHistory } from "@/modules/market/providers/dnse/market-runtime"
import { toCanonicalOrderbookSnapshot } from "@/lib/market-data-contract"

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

    const canonical = toCanonicalOrderbookSnapshot(symbol, data)

    return {
      symbol: canonical.symbol,
      sessionStart: Math.floor(Date.now() / 1000),
      generatedAt: canonical.updatedAt,
      prices: canonical.intraday1m.map((p) => ({
        time: typeof p.time === "number" ? p.time : Math.floor(Date.now() / 1000),
        open: p.open,
        close: p.close,
      })),
      trades: canonical.trades.map((t) => {
        const [hh, mm, ss] = t.time.split(":").map(Number)
        return {
          id: t.id,
          time: (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0),
          price: t.price,
          volume: t.volume,
          side: t.side,
        }
      }),
      tradesTruncated: canonical.tradesTruncated,
      latestQuote: {
        reference: canonical.referencePrice,
        ceiling: canonical.ceilingPrice,
        floor: canonical.floorPrice,
        matchPrice: canonical.latestPrice,
        openPrice: canonical.latestQuote.openPrice,
        highPrice: canonical.latestQuote.highPrice,
        lowPrice: canonical.latestQuote.lowPrice,
        avgPrice: canonical.latestQuote.avgPrice,
        totalVolume: canonical.totalVolume,
        bid: canonical.latestQuote.bids,
        offer: canonical.latestQuote.asks,
        time: Math.floor(Date.now() / 1000),
      },
      foreign: canonical.foreignFlow as any,
      putThrough: canonical.putThrough as any,
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

        const canonical = toCanonicalOrderbookSnapshot(upper, row)
        onSnapshot({
          symbol: canonical.symbol,
          sessionStart: Math.floor(Date.now() / 1000),
          generatedAt: canonical.updatedAt,
          prices: canonical.intraday1m.map((p) => ({
            time: typeof p.time === "number" ? p.time : Math.floor(Date.now() / 1000),
            open: p.open,
            close: p.close,
          })),
          trades: canonical.trades.map((t) => {
            const [hh, mm, ss] = t.time.split(":").map(Number)
            return {
              id: t.id,
              time: (hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0),
              price: t.price,
              volume: t.volume,
              side: t.side,
            }
          }),
          tradesTruncated: canonical.tradesTruncated,
          latestQuote: {
            reference: canonical.referencePrice,
            ceiling: canonical.ceilingPrice,
            floor: canonical.floorPrice,
            matchPrice: canonical.latestPrice,
            openPrice: canonical.latestQuote.openPrice,
            highPrice: canonical.latestQuote.highPrice,
            lowPrice: canonical.latestQuote.lowPrice,
            avgPrice: canonical.latestQuote.avgPrice,
            totalVolume: canonical.totalVolume,
            bid: canonical.latestQuote.bids,
            offer: canonical.latestQuote.asks,
            time: Math.floor(Date.now() / 1000),
          },
          foreign: canonical.foreignFlow as any,
          putThrough: canonical.putThrough as any,
        })
      }
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}
