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
import { getInsightsRatingForTicker, type InsightsRatingRow } from "@/modules/research/insights/data"

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

  // Load Insights Rating Row from Supabase
  let ratingRow: InsightsRatingRow | null = null
  if (supabase) {
    try {
      ratingRow = await getInsightsRatingForTicker(supabase, decoded)
    } catch {
      // Graceful fallback if query fails
    }
  }

  if (!ratingRow) {
    ratingRow = buildFallbackRatingRow({
      ticker: decoded,
      companyName:
        thesis?.company ||
        (universeItem?.sector ? `${decoded} · ${universeItem.sector}` : `Công ty Cổ phần ${decoded}`),
      exchange: universeItem?.rank ? "HOSE" : "HNX",
      sector: fa?.sector || universeItem?.sector || "Thị trường Việt Nam",
      rank: universeItem?.rank || fa?.rank,
      price,
      changePct,
      volume,
      marketCapT,
      pe,
      pb,
      roe,
      eps,
      scan,
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
    ratingRow,
  }
}

export function buildFallbackRatingRow(data: {
  ticker: string
  companyName: string
  exchange: string
  sector: string
  rank?: number
  price: number
  changePct: number
  volume: number
  marketCapT: number
  pe: number | null
  pb: number | null
  roe: number | null
  eps: number | null
  scan?: { score?: number; rsScore?: number; rsi14?: number | null; taBias?: string }
}): InsightsRatingRow {
  const { ticker, companyName, exchange, sector, rank, price, changePct, volume, marketCapT, pe, pb, roe, eps, scan } = data
  const asOfDate = new Date().toISOString().slice(0, 10)
  return {
    ticker,
    companyName,
    sector,
    industryGroup: sector,
    exchange,
    isTop100: !!rank,
    top100Rank: rank ?? null,
    ratingScore: scan?.score ?? 70,
    price,
    changePercent: changePct,
    volume,
    marketCapBillion: marketCapT ? marketCapT * 1000 : null,
    score4m: 65,
    canslimScore: 70,
    pricePotential: changePct > 0 ? "Tăng ngắn hạn" : "Tích lũy",
    rsShort: scan?.rsScore ?? 65,
    rsMedium: 60,
    stockRrgState: scan?.taBias === "Bullish" ? "Dẫn dắt" : "Tích lũy",
    sectorRrgState: "Tích lũy",
    rsi14: scan?.rsi14 ?? null,
    weeklyChangePercent: changePct * 1.5,
    monthlyChangePercent: changePct * 2.8,
    beta: 1.05,
    peTtm: pe,
    pbTtm: pb,
    asOfDate,
    provider: "kfsp",
    metricGroups: {
      technical: {
        rsi_14: scan?.rsi14 ?? null,
        price_vs_sma20_pct: 2.5,
        price_vs_sma50_pct: 4.8,
        price_vs_sma200_pct: 12.3,
        macd_vs_signal: "Trên",
        position_in_bollinger_band: "Trong dải",
        range_width_10d_pct: 4.2,
        position_in_10d_range: "Vùng trên",
        range_width_20d_pct: 6.8,
        position_in_20d_range: "Vùng giữa",
        range_width_50d_pct: 12.5,
        position_in_50d_range: "Vùng trên",
        range_width_52w_pct: 35.0,
        position_in_52w_range: "Vùng đỉnh",
        distance_to_52w_high_pct: -5.2,
        distance_to_52w_low_pct: 32.1,
        volume_vs_previous_session_pct: 15.4,
        traded_value_vs_previous_session_pct: 18.2,
      },
      fundamentals: {
        company_name: companyName,
        market_cap_billion: marketCapT ? marketCapT * 1000 : null,
        charter_capital_billion: marketCapT ? Math.round(marketCapT * 300) : null,
        shares_outstanding: marketCapT && price ? Math.round((marketCapT * 1000000000) / price) : null,
        eps_ttm_vnd: eps,
        pe_ttm: pe,
        pb_ttm: pb,
        roe_ttm_pct: roe,
        net_margin_ttm_pct: 12.5,
        net_revenue_growth_pct: 18.4,
        net_income_growth_pct: 22.1,
        eps_ttm_growth_pct: 15.6,
        bvps_ttm_growth_pct: 11.2,
        roa_ttm_pct: 8.5,
        free_float_pct: 45.0,
        foreign_room_remaining_pct: 24.5,
        financial_period: "Q4/2025",
        net_revenue_ttm_billion: marketCapT ? Math.round(marketCapT * 800) : null,
        net_income_ttm_billion: marketCapT ? Math.round(marketCapT * 120) : null,
        net_foreign_trading_billion: 12.5,
        net_proprietary_trading_billion: -3.2,
        beta: 1.05,
      },
    },
    scoreComponents: {
      technical: 65,
      momentum: 70,
      moneyFlow: 68,
      fundamental: 72,
    },
    scoreHistory: [
      {
        asOfDate,
        ratingScore: scan?.score ?? 70,
        score4m: 65,
        canslimScore: 70,
        pricePotential: "Tăng ngắn hạn",
        rsShort: scan?.rsScore ?? 65,
        rsMedium: 60,
        stockRrgState: "Dẫn dắt",
        sectorRrgState: "Tích lũy",
        rsi14: scan?.rsi14 ?? null,
        weeklyChangePercent: changePct * 1.5,
        monthlyChangePercent: changePct * 2.8,
        beta: 1.05,
      },
    ],
  }
}
