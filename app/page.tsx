import { LiveMarketBoard, type BoardUniverseStock } from "@/components/live-market-board"
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
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <TopNav />
      <main className="min-h-0 flex-1">
        <LiveMarketBoard universe={universe} />
      </main>
    </div>
  )
}
