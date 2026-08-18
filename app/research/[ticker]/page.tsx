import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { NotionUnavailable } from "@/components/notion-unavailable"
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
  // Kick off both Notion fetches concurrently — research and scanner are independent
  const scannerPromise = getScannerData().catch((error: unknown) => {
    console.error(`[StockOS detail] Notion scanner data failed for ${decoded}`, error)
    return null
  })
  const research = await getResearchData()
  if (!research.connection.notionLive) return <NotionUnavailable section={`Nghiên cứu ${decoded}`} detail={research.connection.message} />

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

  // Await scanner (already in-flight since above)
  const scannerResult = await scannerPromise
  if (!scannerResult) {
    return <NotionUnavailable section={`Nghiên cứu ${decoded}`} detail="Không đọc được scanner state từ Notion." />
  }
  const scanner = scannerResult
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

  // Fetch daily and hourly history concurrently — they are fully independent
  const cutoff = scan?.date ? new Date(`${scan.date}T23:59:59+07:00`) : new Date()
  const [dailyResult, hourlyResult] = await Promise.allSettled([
    fetchDailyMarketHistory(decoded, cutoff),
    fetchHourlyMarketHistory(decoded, new Date()),
  ])

  if (dailyResult.status === "fulfilled") {
    const history = dailyResult.value
    bars = history.bars
    if (scan?.date) bars = bars.filter((bar) => barDate(bar) <= scan.date)
    historyMeta = { provider: history.provider, detail: history.detail }
  } else {
    console.error(`[StockOS detail] historical data failed for ${decoded}`, dailyResult.reason)
  }

  if (hourlyResult.status === "fulfilled") {
    const hourly = hourlyResult.value
    hourlyBars = hourly.bars
    hourlyMeta = { provider: hourly.provider, detail: hourly.detail }
  } else {
    const err = hourlyResult.reason
    hourlyMeta = { provider: "Unavailable", detail: err instanceof Error ? err.message.slice(0, 220) : String(err).slice(0, 220) }
    console.error(`[StockOS detail] intraday data failed for ${decoded}`, err)
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
      <StockDetailApp ticker={decoded} thesis={thesis} scan={scan} universe={universe} bars={bars} historyMeta={historyMeta} logs={logs} vnindex={vnindex} previousTicker={previousTicker} nextTicker={nextTicker} studies={studies} />
    </>
  )
}
