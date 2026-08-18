import { LiveMarketBoardV2, type BoardUniverseStock } from "@/components/live-market-board-v2"
import { NotionUnavailable } from "@/components/notion-unavailable"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { TopNav } from "@/components/top-nav"
import { getScannerData } from "@/lib/scanner-data"
import { sectorForTicker } from "@/lib/market-sectors"

export const dynamic = "force-dynamic"

export default async function Page() {
  let data: Awaited<ReturnType<typeof getScannerData>>
  try {
    data = await getScannerData()
  } catch (error) {
    console.error("[QeoIndex board] Notion read failed", error)
    return <NotionUnavailable section="Bảng điện" detail="Không đọc được Wyckoff Universe / Daily Scan từ Notion. Market data không được dùng để thay thế persistent state." />
  }
  const universe: BoardUniverseStock[] = data.universe.map((stock) => ({
    ticker: stock.ticker,
    rank: stock.rank,
    sector: stock.sector || sectorForTicker(stock.ticker),
    marketCapT: stock.marketCapT,
    lastClose: data.latestScans[stock.ticker]?.price ?? null,
    lastCloseDate: data.latestScans[stock.ticker]?.date ?? "",
  }))
  return (
    <OrderBookProvider>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopNav />
        <main className="min-h-0 flex-1"><LiveMarketBoardV2 universe={universe} /></main>
        <OrderBookManager />
      </div>
    </OrderBookProvider>
  )
}
