import { LiveMarketBoardV2, type BoardUniverseStock, type IndexQuote } from "@/components/live-market-board-v2"
import { NotionUnavailable } from "@/components/notion-unavailable"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { TopNav } from "@/components/top-nav"
import { getScannerData } from "@/lib/scanner-data"
import { sectorForTicker } from "@/lib/market-sectors"
import { getAllOrderbookSnapshotsFromSupabase } from "@/lib/supabase/orderbook"
import type { LiveStockQuote } from "@/components/live-market-stock"
import type { IntradayPoint } from "@/lib/intraday-5m"

export const dynamic = "force-dynamic"

export default async function Page() {
  let data: Awaited<ReturnType<typeof getScannerData>>
  try {
    data = await getScannerData()
  } catch (error) {
    console.error("[QeoIndex board] Notion read failed", error)
    return <NotionUnavailable section="Bảng điện" detail="Không đọc được Wyckoff Universe / Daily Scan từ Notion. Market data không được dùng để thay thế persistent state." />
  }

  const snapshots = await getAllOrderbookSnapshotsFromSupabase()

  const universe: BoardUniverseStock[] = data.universe.map((stock) => {
    const snap = snapshots[stock.ticker]
    const lastClosePrice = snap?.latest_price || snap?.reference_price || data.latestScans[stock.ticker]?.price || null
    return {
      ticker: stock.ticker,
      rank: stock.rank,
      sector: stock.sector || sectorForTicker(stock.ticker),
      marketCapT: stock.marketCapT,
      lastClose: lastClosePrice,
      lastCloseDate: snap?.session_date || data.latestScans[stock.ticker]?.date || "",
    }
  })

  const initialQuotes: Record<string, LiveStockQuote | IndexQuote> = {}
  const initialHistories: Record<string, IntradayPoint[]> = {}

  for (const stock of universe) {
    const snap = snapshots[stock.ticker]
    if (snap && snap.latest_price && snap.latest_price > 0) {
      const ref = snap.reference_price || snap.latest_price
      const change = snap.latest_price - ref
      const changePercent = ref > 0 ? (change / ref) * 100 : 0
      initialQuotes[stock.ticker] = {
        symbol: stock.ticker,
        price: snap.latest_price,
        reference: ref,
        ceiling: snap.ceiling_price ?? undefined,
        floor: snap.floor_price ?? undefined,
        change,
        changePercent,
        volume: snap.total_volume || 0,
        updatedAt: snap.updated_at,
      }
      if (Array.isArray(snap.intraday_1m) && snap.intraday_1m.length > 0) {
        initialHistories[stock.ticker] = snap.intraday_1m as unknown as IntradayPoint[]
      }
    }
  }

  return (
    <OrderBookProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopNav />
        <main className="min-h-0 flex-1">
          <LiveMarketBoardV2 universe={universe} initialQuotes={initialQuotes} initialHistories={initialHistories} />
        </main>
        <OrderBookManager />
      </div>
    </OrderBookProvider>
  )
}
