import { LiveMarketBoardV2, type BoardUniverseStock, type IndexQuote } from "@/components/live-market-board-v2"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { TopNav } from "@/components/top-nav"
import { sectorForTicker } from "@/lib/market-sectors"
import { CANONICAL_UNIVERSE_STOCKS, CANONICAL_UNIVERSE_TICKERS } from "@/lib/wyckoff-universe"
import { getBoardOverviewSnapshotsFromSupabase } from "@/lib/supabase/orderbook"
import { isTradingSessionOpen } from "@/lib/session-countdown"
import { fetchLiveBatchQuotes } from "@/lib/broker-live-quotes"
import type { LiveStockQuote } from "@/components/live-market-stock"
import type { IntradayPoint } from "@/lib/intraday-5m"

export const dynamic = "force-dynamic"

export default async function Page() {
  const isSessionOpen = isTradingSessionOpen(new Date())

  // Read live broker quotes and Supabase snapshots in parallel (sub-150ms)
  const [snapshots, liveQuotes] = await Promise.all([
    getBoardOverviewSnapshotsFromSupabase(),
    fetchLiveBatchQuotes(CANONICAL_UNIVERSE_TICKERS),
  ])

  const universe: BoardUniverseStock[] = CANONICAL_UNIVERSE_STOCKS.map((stock) => {
    const snap = snapshots[stock.ticker]
    const live = liveQuotes[stock.ticker]
    const lastClosePrice = live?.price || snap?.latest_price || snap?.reference_price || null
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
    const live = liveQuotes[stock.ticker]
    const intraday = Array.isArray(snap?.intraday_1m) ? (snap.intraday_1m as unknown as IntradayPoint[]) : []
    const lastBarClose = intraday.length > 0 ? (intraday[intraday.length - 1].close ?? (intraday[intraday.length - 1] as any)?.c) : null
    const firstBarOpen = intraday.length > 0 ? ((intraday[0] as any)?.open ?? (intraday[0] as any)?.o ?? intraday[0]?.close) : null

    const latestPrice = live?.price || snap?.latest_price || snap?.reference_price || lastBarClose || firstBarOpen
    const ref = live?.reference || snap?.reference_price || firstBarOpen || latestPrice

    if (latestPrice && latestPrice > 0 && ref && ref > 0) {
      const change = live?.change ?? (latestPrice - ref)
      const changePercent = live?.changePercent ?? ((change / ref) * 100)
      initialQuotes[stock.ticker] = {
        symbol: stock.ticker,
        price: latestPrice,
        reference: ref,
        ceiling: live?.ceiling ?? snap?.ceiling_price ?? Math.round(ref * 1.07 * 100) / 100,
        floor: live?.floor ?? snap?.floor_price ?? Math.round(ref * 0.93 * 100) / 100,
        change,
        changePercent,
        volume: live?.volume || snap?.total_volume || 0,
        foreignNetValue: (snap?.foreign_flow as any)?.foreignNetValue,
        foreignBuyValue: (snap?.foreign_flow as any)?.totalBuyValue,
        foreignSellValue: (snap?.foreign_flow as any)?.totalSellValue,
        foreignBuyVolume: (snap?.foreign_flow as any)?.totalBuyVolume,
        foreignSellVolume: (snap?.foreign_flow as any)?.totalSellVolume,
        updatedAt: snap?.updated_at || new Date().toISOString(),
      }
      if (intraday.length > 0) {
        initialHistories[stock.ticker] = intraday
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
