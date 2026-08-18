import { LiveMarketBoardV2, type BoardUniverseStock, type IndexQuote } from "@/components/live-market-board-v2"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { TopNav } from "@/components/top-nav"
import { sectorForTicker } from "@/lib/market-sectors"
import { CANONICAL_UNIVERSE_STOCKS } from "@/lib/wyckoff-universe"
import { getAllOrderbookSnapshotsFromSupabase } from "@/lib/supabase/orderbook"
import { isTradingSessionOpen } from "@/lib/session-countdown"
import type { LiveStockQuote } from "@/components/live-market-stock"
import type { IntradayPoint } from "@/lib/intraday-5m"

export const dynamic = "force-dynamic"

export default async function Page() {
  const isSessionOpen = isTradingSessionOpen(new Date())

  // Read EOD snapshots directly from Supabase database
  const snapshots = await getAllOrderbookSnapshotsFromSupabase()

  const universe: BoardUniverseStock[] = CANONICAL_UNIVERSE_STOCKS.map((stock) => {
    const snap = snapshots[stock.ticker]
    const lastClosePrice = snap?.latest_price || snap?.reference_price || (snap?.latest_quote as any)?.matchPrice || (snap?.latest_quote as any)?.reference || null
    return {
      ticker: stock.ticker,
      rank: stock.rank,
      sector: sectorForTicker(stock.ticker),
      marketCapT: stock.marketCapT,
      lastClose: lastClosePrice,
      lastCloseDate: snap?.session_date || "",
    }
  })

  const initialQuotes: Record<string, LiveStockQuote | IndexQuote> = {}
  const initialHistories: Record<string, IntradayPoint[]> = {}

  for (const stock of universe) {
    const snap = snapshots[stock.ticker]
    const latestPrice = snap?.latest_price || (snap?.latest_quote as any)?.matchPrice || snap?.reference_price || (Array.isArray(snap?.trades) && snap.trades.length > 0 ? (snap.trades[snap.trades.length - 1] as any)?.price : null)
    const ref = snap?.reference_price || (snap?.latest_quote as any)?.reference || latestPrice

    if (latestPrice && latestPrice > 0 && ref && ref > 0) {
      const change = latestPrice - ref
      const changePercent = (change / ref) * 100
      initialQuotes[stock.ticker] = {
        symbol: stock.ticker,
        price: latestPrice,
        reference: ref,
        ceiling: snap?.ceiling_price ?? Math.round(ref * 1.07 * 100) / 100,
        floor: snap?.floor_price ?? Math.round(ref * 0.93 * 100) / 100,
        change,
        changePercent,
        volume: snap?.total_volume || (snap?.latest_quote as any)?.totalVolume || 0,
        foreignNetValue: (snap?.foreign_flow as any)?.foreignNetValue,
        foreignBuyValue: (snap?.foreign_flow as any)?.totalBuyValue,
        foreignSellValue: (snap?.foreign_flow as any)?.totalSellValue,
        foreignBuyVolume: (snap?.foreign_flow as any)?.totalBuyVolume,
        foreignSellVolume: (snap?.foreign_flow as any)?.totalSellVolume,
        updatedAt: snap?.updated_at || new Date().toISOString(),
      }
      if (Array.isArray(snap?.intraday_1m) && snap.intraday_1m.length > 0) {
        initialHistories[stock.ticker] = snap.intraday_1m as unknown as IntradayPoint[]
      }
    }
  }

  return (
    <OrderBookProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopNav />
        <main className="min-h-0 flex-1">
          <LiveMarketBoardV2
            universe={universe}
            initialQuotes={initialQuotes}
            initialHistories={initialHistories}
            isSessionOpen={isSessionOpen}
          />
        </main>
        <OrderBookManager />
      </div>
    </OrderBookProvider>
  )
}
