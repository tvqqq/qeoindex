import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { StockDetailData, StockWatchlistItem } from "@/components/stock-detail/types"
import { getAiCouncilRuntimeData } from "@/modules/ai-council/runtime"
import { FA_SCREEN_ROWS } from "@/modules/research/fa-screen-data"
import { buildMultiTimeframeStudies } from "@/modules/research/multi-timeframe"
import {
  getCachedDailyHistory,
  getCachedHourlyHistory,
  getCachedResearchData,
  getCachedScannerData,
} from "@/modules/shared/cache/request-cache"

export async function fetchStockDetailData(
  ticker: string,
  supabase?: SupabaseClient,
): Promise<StockDetailData> {
  let decoded = decodeURIComponent(ticker).trim().toUpperCase()
  if (decoded === "TICKER" || !decoded) {
    decoded = "HPG"
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
  if (supabase) {
    try {
      const councilRuntime = await getAiCouncilRuntimeData(supabase)
      aiStock = councilRuntime.data.stocks.find((s) => s.ticker === decoded)
      aiHistory = councilRuntime.data.history.filter((h) => h.ticker === decoded)
    } catch {
      // Graceful fallback if AI council runtime fails
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
    scanRows.length > 0 ? scanRows.slice(0, 30) : FA_SCREEN_ROWS.slice(0, 30)
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

  return {
    ticker: decoded,
    companyName:
      thesis?.company ||
      (universeItem?.sector ? `${decoded} · ${universeItem.sector}` : `Công ty Cổ phần ${decoded}`),
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
}
