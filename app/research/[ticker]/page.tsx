import { Suspense } from "react"
import { ArrowLeft, ArrowRight } from "lucide-react"
import Link from "next/link"

import { FinhayLiveControl } from "@/components/research/finhay-live-control"
import { TopNav } from "@/components/top-nav"
import { VnindexResearchSection } from "@/components/research/ticker-sections"
import { StockDetailWorkstation } from "@/components/stock-detail/stock-detail-workstation"
import type { StockDetailData, StockWatchlistItem } from "@/components/stock-detail/types"
import {
  getCachedDailyHistory,
  getCachedHourlyHistory,
  getCachedResearchData,
  getCachedScannerData,
} from "@/modules/shared/cache/request-cache"
import { buildMultiTimeframeStudies } from "@/modules/research/multi-timeframe"
import { FA_SCREEN_ROWS } from "@/modules/research/fa-screen-data"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { getAiCouncilData } from "@/modules/ai-council/data"

export const dynamic = "force-dynamic"

export default async function ResearchTickerPage({
  params,
}: {
  params: Promise<{ ticker: string }>
}) {
  const { ticker } = await params
  const decoded = decodeURIComponent(ticker).toUpperCase()
  const isIndex = decoded === "VNINDEX"

  if (isIndex) {
    return (
      <div className="min-h-screen bg-background text-[15px]">
        <TopNav />
        <div className="fixed bottom-4 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/98 p-3 shadow-[0_12px_32px_-20px_rgba(0,0,0,0.9)]">
          <FinhayLiveControl indexes={[decoded]} />
        </div>
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center text-sm text-foreground/50">
              Đang tải nghiên cứu VNINDEX...
            </div>
          }
        >
          <VnindexResearchSection ticker={decoded} />
        </Suspense>
      </div>
    )
  }

  // Load research, scanner, and OHLCV history in parallel
  const [researchData, scannerData, dailyHistory, hourlyHistory] = await Promise.all([
    getCachedResearchData(),
    getCachedScannerData(),
    getCachedDailyHistory(decoded),
    getCachedHourlyHistory(decoded),
  ])

  // Attempt to load AI Council data
  let aiStock = undefined
  let aiHistory = undefined
  const supabase = getSupabaseServerClient()
  if (supabase) {
    try {
      const councilData = await getAiCouncilData(supabase)
      aiStock = councilData.stocks.find((s) => s.ticker === decoded)
      aiHistory = councilData.history.filter((h) => h.ticker === decoded)
    } catch {
      // Graceful fallback if AI council table is unavailable
    }
  }

  const scan = scannerData.latestScans[decoded]
  const thesis = researchData.theses.find((t) => t.ticker === decoded)
  const universeItem = scannerData.universe.find((u) => u.ticker === decoded)
  const fa = FA_SCREEN_ROWS.find((f) => f.ticker === decoded)
  const logs = researchData.logs.filter((l) => l.ticker === decoded)
  const studies = buildMultiTimeframeStudies({
    dailyBars: dailyHistory.bars,
    hourlyBars: hourlyHistory.bars,
    dailyProvider: dailyHistory.provider,
    dailyDetail: dailyHistory.detail,
    hourlyProvider: hourlyHistory.provider,
    hourlyDetail: hourlyHistory.detail,
  })

  const lastBar = dailyHistory.bars.at(-1)
  const price = scan?.price || lastBar?.close || 28000
  const changePct = scan?.changePct ?? 0
  const change = (price * changePct) / 100
  const refPrice = changePct !== 0 ? Math.round(price / (1 + changePct / 100)) : price
  const highPrice = lastBar?.high || price
  const lowPrice = lastBar?.low || price
  const ceilingPrice = Math.round(refPrice * 1.07)
  const floorPrice = Math.round(refPrice * 0.93)
  const volume = scan?.volume || lastBar?.volume || 0
  const marketCapT = universeItem?.marketCapT || 150
  const pe = fa?.pe ?? null
  const pb = fa?.pb ?? null
  const roe = fa?.roe ?? null
  const eps = pe && price ? Math.round(price / pe) : null

  // Build watchlist from top scanner and FA stocks
  const scanRows = Object.values(scannerData.latestScans)
  const watchlist: StockWatchlistItem[] = (
    scanRows.length > 0 ? scanRows.slice(0, 25) : FA_SCREEN_ROWS.slice(0, 25)
  ).map((row) => {
    const sym = row.ticker
    const faRow = FA_SCREEN_ROWS.find((f) => f.ticker === sym)
    const p = "price" in row && typeof row.price === "number" ? row.price : 28000
    const cp = "changePct" in row && typeof row.changePct === "number" ? row.changePct : 0
    return {
      ticker: sym,
      companyName: faRow?.sector || sym,
      price: p,
      change: (p * cp) / 100,
      changePct: cp,
    }
  })

  // Ensure current ticker is in watchlist
  if (!watchlist.some((w) => w.ticker === decoded)) {
    watchlist.unshift({
      ticker: decoded,
      companyName: fa?.sector || decoded,
      price,
      change,
      changePct,
    })
  }

  const stockDetailData: StockDetailData = {
    ticker: decoded,
    companyName: thesis?.company || (universeItem?.sector ? `${decoded} · ${universeItem.sector}` : `Công ty Cổ phần ${decoded}`),
    exchange: universeItem?.rank ? "HOSE" : "HNX",
    sector: fa?.sector || universeItem?.sector || "Thị trường Việt Nam",
    rank: universeItem?.rank || fa?.rank,
    price,
    change,
    changePct,
    refPrice,
    highPrice,
    lowPrice,
    ceilingPrice,
    floorPrice,
    volume,
    marketCapT,
    pe,
    pb,
    roe,
    eps,
    bars: dailyHistory.bars,
    hourlyBars: hourlyHistory.bars,
    aiStock,
    aiHistory,
    scan,
    thesis,
    fa,
    universe: universeItem,
    studies,
    logs,
    watchlist,
  }

  return (
    <>
      <StockDetailWorkstation data={stockDetailData} />
      <div className="fixed bottom-3 right-4 z-50 max-w-[min(92vw,720px)] rounded-xl border border-border bg-panel/98 p-2.5 shadow-[0_12px_32px_-20px_rgba(0,0,0,0.9)]">
        <FinhayLiveControl symbols={[decoded]} />
      </div>
    </>
  )
}
