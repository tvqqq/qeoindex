import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { StockDetailData, StockWatchlistItem } from "@/components/stock-detail/types"
import { getChartOhlcv } from "@/modules/market/chart-data/timeframe-service"
import { FA_SCREEN_ROWS } from "@/modules/research/fa-screen-data"
import { buildMultiTimeframeStudies } from "@/modules/research/multi-timeframe"
import { buildFallbackRatingRow, VN_TOP_COMPANY_NAMES } from "@/modules/research/insights/stock-detail-data"

function normalizeTicker(ticker: string) {
  const decoded = decodeURIComponent(ticker).trim().toUpperCase()
  return decoded === "TICKER" || !decoded ? "HPG" : decoded
}

export async function fetchStockDetailCriticalData(
  ticker: string,
  supabase: SupabaseClient,
): Promise<StockDetailData> {
  const decoded = normalizeTicker(ticker)
  const bootstrapStartedAt = performance.now()
  const dailyStartedAt = performance.now()
  const to = Math.floor(Date.now() / 1000)
  const from = to - 620 * 24 * 60 * 60
  const dailyResult = await getChartOhlcv(
    { supabase },
    { ticker: decoded, resolution: "1D", from, to },
  )
  const dailyMs = Number((performance.now() - dailyStartedAt).toFixed(1))
  const bars = dailyResult.bars
  const fa = FA_SCREEN_ROWS.find((row) => row.ticker === decoded)
  const lastBar = bars.at(-1)
  const previousBar = bars.at(-2)
  const price = lastBar?.close ?? 28_000
  const change = lastBar && previousBar ? lastBar.close - previousBar.close : 0
  const changePct = previousBar?.close ? (change / previousBar.close) * 100 : 0
  const refPrice = previousBar?.close ?? price
  const highPrice = lastBar?.high ?? price
  const lowPrice = lastBar?.low ?? price
  const volume = lastBar?.volume ?? 0
  const marketCapT = 150
  const pe = fa?.pe ?? null
  const pb = fa?.pb ?? null
  const roe = fa?.roe ?? null
  const eps = pe && price ? Math.round(price / pe) : null
  const companyName = VN_TOP_COMPANY_NAMES[decoded] ?? `Công ty Cổ phần ${decoded}`
  const sector = fa?.sector ?? "Thị trường Việt Nam"
  const exchange = "HOSE"
  const watchlist: StockWatchlistItem[] = [{
    ticker: decoded,
    companyName,
    price,
    change,
    changePct,
  }]
  const studies = buildMultiTimeframeStudies({
    dailyBars: bars,
    hourlyBars: [],
    dailyProvider: dailyResult.metadata?.provider ?? "CANONICAL_DAILY",
    dailyDetail: "Supabase market_ohlcv_history · chart-critical 1D seed",
    hourlyProvider: "RETIRED_INTRADAY",
    hourlyDetail: "Intraday history retired; Daily is the minimum timeframe",
  })
  const ratingRow = buildFallbackRatingRow({
    ticker: decoded,
    companyName,
    exchange,
    sector,
    rank: fa?.rank,
    price,
    changePct,
    volume,
    marketCapT,
    pe,
    pb,
    roe,
    eps,
  })

  const result: StockDetailData = {
    ticker: decoded,
    companyName,
    exchange,
    sector,
    rank: fa?.rank,
    price,
    change,
    changePct,
    refPrice,
    highPrice,
    lowPrice,
    ceilingPrice: Math.round(refPrice * 1.07),
    floorPrice: Math.round(refPrice * 0.93),
    volume,
    marketCapT,
    pe,
    pb,
    roe,
    eps,
    bars,
    hourlyBars: [],
    fa,
    studies,
    watchlist,
    ratingRow,
  }

  console.info("[qeo172-critical-bootstrap]", JSON.stringify({
    ticker: decoded,
    dailyMs,
    totalMs: Number((performance.now() - bootstrapStartedAt).toFixed(1)),
  }))
  return result
}
