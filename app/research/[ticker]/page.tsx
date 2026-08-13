import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { ResearchApp } from "@/components/research/research-app"
import { StockDetailApp } from "@/components/research/stock-detail-app"
import { fetchDailyMarketHistory, fetchHourlyMarketHistory } from "@/lib/market-history"
import { buildMultiTimeframeStudies } from "@/lib/multi-timeframe"
import { getResearchData } from "@/lib/research-data"
import { getScannerData } from "@/lib/scanner-data"
import type { OhlcvBar } from "@/lib/technical-indicators"

export const dynamic = "force-dynamic"

function barDate(bar: OhlcvBar) {
  return new Date(bar.time * 1000).toISOString().slice(0, 10)
}

export default async function ResearchTickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const decoded = decodeURIComponent(ticker).toUpperCase()
  const isIndex = decoded === "VNINDEX"
  const [research, scanner] = await Promise.all([getResearchData(), getScannerData()])

  if (isIndex) {
    return (
      <>
        <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
          <FinhayLiveControl indexes={[decoded]} />
        </div>
        <ResearchApp data={research} mode="ticker" ticker={decoded} />
      </>
    )
  }

  const thesis = research.theses.find((row) => row.ticker === decoded)
  const universeIndex = scanner.universe.findIndex((row) => row.ticker === decoded)
  const universe = universeIndex >= 0 ? scanner.universe[universeIndex] : undefined
  const scan = scanner.latestScans[decoded]
  const logs = research.logs
    .filter((row) => row.ticker === decoded)
    .sort((a, b) => new Date(b.date || b.updated || 0).getTime() - new Date(a.date || a.updated || 0).getTime())
  const vnindex = research.theses.find((row) => row.ticker === "VNINDEX")

  let bars: OhlcvBar[] = []
  let historyMeta: { provider: string; detail: string } | undefined
  let hourlyBars: OhlcvBar[] = []
  let hourlyMeta: { provider: string; detail: string } = { provider: "Unavailable", detail: "1H provider unavailable" }
  try {
    const cutoff = scan?.date ? new Date(`${scan.date}T23:59:59+07:00`) : new Date()
    const history = await fetchDailyMarketHistory(decoded, cutoff)
    bars = history.bars
    if (scan?.date) bars = bars.filter((bar) => barDate(bar) <= scan.date)
    historyMeta = { provider: history.provider, detail: history.detail }
  } catch (error) {
    console.error(`[StockOS detail] historical data failed for ${decoded}`, error)
  }

  try {
    const hourly = await fetchHourlyMarketHistory(decoded, new Date())
    hourlyBars = hourly.bars
    hourlyMeta = { provider: hourly.provider, detail: hourly.detail }
  } catch (error) {
    hourlyMeta = { provider: "Unavailable", detail: error instanceof Error ? error.message.slice(0, 220) : String(error).slice(0, 220) }
    console.error(`[StockOS detail] intraday data failed for ${decoded}`, error)
  }

  const studies = buildMultiTimeframeStudies({
    dailyBars: bars,
    hourlyBars,
    dailyProvider: historyMeta?.provider ?? "Unavailable",
    dailyDetail: historyMeta?.detail ?? "Daily provider unavailable",
    hourlyProvider: hourlyMeta.provider,
    hourlyDetail: hourlyMeta.detail,
  })

  const previousTicker = universeIndex > 0 ? scanner.universe[universeIndex - 1]?.ticker : undefined
  const nextTicker = universeIndex >= 0 && universeIndex < scanner.universe.length - 1 ? scanner.universe[universeIndex + 1]?.ticker : undefined

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/95 p-3 shadow-2xl backdrop-blur">
        <FinhayLiveControl symbols={[decoded]} />
      </div>
      <StockDetailApp
        ticker={decoded}
        thesis={thesis}
        scan={scan}
        universe={universe}
        bars={bars}
        historyMeta={historyMeta}
        logs={logs}
        vnindex={vnindex}
        previousTicker={previousTicker}
        nextTicker={nextTicker}
        studies={studies}
      />
    </>
  )
}
