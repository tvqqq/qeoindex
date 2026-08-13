import { LiveMarketBoardV2, type BoardUniverseStock } from "@/components/live-market-board-v2"
import { OrderBookProvider } from "@/components/orderbook/orderbook-context"
import { OrderBookManager } from "@/components/orderbook/orderbook-manager"
import { TopNav } from "@/components/top-nav"
import { getScannerData } from "@/lib/scanner-data"
import { sectorForTicker } from "@/lib/market-sectors"

export const dynamic = "force-dynamic"

export default async function Page() {
  const data = await getScannerData()
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
        <main className="min-h-0 flex-1">
          <LiveMarketBoardV2 universe={universe} universeSource={data.source} />
        </main>
        <OrderBookManager />
      </div>
    </OrderBookProvider>
  )
}
