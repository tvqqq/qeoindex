import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDnseIndexCandleHistory } from "@/lib/dnse-index-candles"
import { FA_SCREEN_ROWS, FA_SCREEN_SNAPSHOT_DATE } from "@/lib/fa-screen-data"
import { getResearchOverviewData } from "@/lib/research-data"
import { getScannerData } from "@/lib/scanner-data"
import { getSignalUiData } from "@/lib/signal-data"
import { buildRecommendationPerformance } from "@/lib/signal-performance"
import { fetchTradingViewIndexes, type MarketIndexQuote } from "@/lib/tradingview-index"

export interface InsightsRatingRow {
  ticker: string
  companyName: string
  sector: string
  ratingScore: number
  price: number | null
  changePercent: number | null
  volume: number | null
  asOfDate: string
  provider: string
  scoreComponents: {
    technical: number
    momentum: number
    moneyFlow: number
    fundamental: number
  }
}

export interface InsightsModuleSummary {
  key: "scanner" | "signals" | "fa" | "research"
  label: string
  value: string
  detail: string
  href: string
  status: string
}

export interface InsightsDashboardData {
  generatedAt: string
  vnindex: MarketIndexQuote | null
  vnindexSeries: number[]
  ratings: InsightsRatingRow[]
  ratingMode: "supabase" | "preview"
  ratingMessage: string
  marketPulse: {
    label: string
    headline: string
    detail: string
    support: string
    resistance: string
    riskScore: number
  }
  modules: InsightsModuleSummary[]
  faSnapshotDate: string
}

type RatingDatabaseRow = {
  ticker: string
  sector: string | null
  exchange: string | null
  composite_score: number | null
  score_4m: number | null
  canslim_score: number | null
  stock_rs_score: number | null
  sector_rs_score: number | null
  price: number | null
  price_change_pct: number | null
  as_of_date: string
  source: string
}

const RATING_PREVIEW: InsightsRatingRow[] = [
  { ticker: "FPT", companyName: "FPT Corporation", sector: "Công nghệ", ratingScore: 94, price: 128.4, changePercent: 2.8, volume: 2_840_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 96, momentum: 93, moneyFlow: 92, fundamental: 95 } },
  { ticker: "MWG", companyName: "Thế Giới Di Động", sector: "Bán lẻ", ratingScore: 91, price: 64.8, changePercent: 1.9, volume: 5_170_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 92, momentum: 94, moneyFlow: 89, fundamental: 88 } },
  { ticker: "VCB", companyName: "Vietcombank", sector: "Ngân hàng", ratingScore: 88, price: 92.1, changePercent: 1.3, volume: 1_210_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 86, momentum: 84, moneyFlow: 88, fundamental: 94 } },
  { ticker: "HPG", companyName: "Hòa Phát", sector: "Thép", ratingScore: 84, price: 28.65, changePercent: 1.1, volume: 12_430_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 87, momentum: 89, moneyFlow: 85, fundamental: 75 } },
  { ticker: "CTG", companyName: "VietinBank", sector: "Ngân hàng", ratingScore: 82, price: 38.2, changePercent: 0.7, volume: 4_320_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 78, momentum: 81, moneyFlow: 83, fundamental: 88 } },
  { ticker: "VHM", companyName: "Vinhomes", sector: "Bất động sản", ratingScore: 76, price: 41.5, changePercent: -0.4, volume: 6_080_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 72, momentum: 68, moneyFlow: 77, fundamental: 87 } },
  { ticker: "SSI", companyName: "SSI Securities", sector: "Chứng khoán", ratingScore: 72, price: 31.25, changePercent: -1.2, volume: 8_660_000, asOfDate: "", provider: "UI preview", scoreComponents: { technical: 69, momentum: 65, moneyFlow: 78, fundamental: 76 } },
]

function componentScore(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : fallback
}

async function loadRatings(supabase: SupabaseClient): Promise<{ rows: InsightsRatingRow[]; message: string }> {
  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error) return { rows: [], message: `Supabase rating chưa sẵn sàng: ${latest.error.message}` }
  if (!latest.data?.as_of_date) return { rows: [], message: "Chưa có snapshot rating được cron công bố." }

  const result = await supabase
    .from("insights_stock_ratings")
    .select("ticker,sector,exchange,composite_score,score_4m,canslim_score,stock_rs_score,sector_rs_score,price,price_change_pct,as_of_date,source")
    .eq("is_published", true)
    .eq("as_of_date", latest.data.as_of_date)
    .order("composite_score", { ascending: false, nullsFirst: false })
    .order("ticker", { ascending: true })
    .limit(100)

  if (result.error) return { rows: [], message: `Không đọc được rating: ${result.error.message}` }
  const rows = (result.data as RatingDatabaseRow[]).flatMap((row) => {
    if (row.composite_score == null) return []
    const ratingScore = componentScore(row.composite_score, 0)
    return [{
      ticker: row.ticker,
      companyName: row.exchange ? `${row.ticker} · ${row.exchange}` : row.ticker,
      sector: row.sector || "Chưa phân ngành",
      ratingScore,
      price: row.price == null ? null : Number(row.price),
      changePercent: row.price_change_pct == null ? null : Number(row.price_change_pct),
      volume: null,
      asOfDate: row.as_of_date,
      provider: row.source,
      scoreComponents: {
        technical: componentScore(row.score_4m, ratingScore),
        momentum: componentScore(row.stock_rs_score, ratingScore),
        moneyFlow: componentScore(row.sector_rs_score, ratingScore),
        fundamental: componentScore(row.canslim_score, ratingScore),
      },
    }]
  })
  return { rows, message: `${rows.length} mã · snapshot ${latest.data.as_of_date}` }
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null
}

function riskScore(quote: MarketIndexQuote | null) {
  if (!quote) return 50
  const breadth = (quote.advances ?? 0) + (quote.declines ?? 0)
  const breadthRisk = breadth ? (quote.declines ?? 0) / breadth * 55 : 25
  const momentumRisk = Math.max(0, Math.min(45, 22 - quote.changePercent * 11))
  return Math.round(Math.max(5, Math.min(95, breadthRisk + momentumRisk)))
}

export async function getInsightsDashboardData(supabase: SupabaseClient): Promise<InsightsDashboardData> {
  const settled = await Promise.allSettled([
    fetchTradingViewIndexes(),
    fetchDnseIndexCandleHistory("VNINDEX", new Date(), "5", 80),
    loadRatings(supabase),
    getScannerData(),
    getSignalUiData(),
    getResearchOverviewData(),
  ] as const)

  const indexes = settledValue(settled[0])
  const candleHistory = settledValue(settled[1])
  const ratingResult = settledValue(settled[2])
  const scanner = settledValue(settled[3])
  const signals = settledValue(settled[4])
  const research = settledValue(settled[5])
  const vnindex = indexes?.VNINDEX ?? null
  const ratings = ratingResult?.rows.length ? ratingResult.rows : RATING_PREVIEW
  const preview = !ratingResult?.rows.length
  const scans = scanner ? Object.values(scanner.latestScans) : []
  const completedScans = scans.filter((row) => row.status === "Complete").length
  const bullishScans = scans.filter((row) => row.taBias === "Bullish").length
  const performance = buildRecommendationPerformance(signals?.recommendations ?? [])
  const attractive = FA_SCREEN_ROWS.filter((row) => row.valuation === "Rất hấp dẫn" || row.valuation === "Hấp dẫn").length
  const highQuality = FA_SCREEN_ROWS.filter((row) => row.grade === "A" || row.grade === "A-").length
  const vnThesis = research?.theses.find((row) => row.ticker === "VNINDEX")
  const stockTheses = research?.theses.filter((row) => row.ticker !== "VNINDEX").length ?? 0
  const risk = riskScore(vnindex)
  const positive = (vnindex?.changePercent ?? 0) >= 0

  return {
    generatedAt: new Date().toISOString(),
    vnindex,
    vnindexSeries: candleHistory?.bars.map((bar) => bar.close).slice(-64) ?? [],
    ratings,
    ratingMode: preview ? "preview" : "supabase",
    ratingMessage: preview
      ? `${ratingResult?.message ?? "Rating backend chưa có dữ liệu."} Đang hiển thị dữ liệu mẫu UI; không phải khuyến nghị đầu tư.`
      : ratingResult?.message ?? "Supabase rating",
    marketPulse: {
      label: positive ? "Động lượng tích cực" : "Động lượng thận trọng",
      headline: vnThesis?.whatChanged || (positive
        ? "VNIndex đang giữ nhịp tăng với độ rộng thị trường cải thiện."
        : "VNIndex đang chịu áp lực; ưu tiên quản trị rủi ro và chọn lọc cổ phiếu."),
      detail: vnThesis?.baseCase || "Tổng hợp tự động từ dữ liệu chỉ số và luận điểm VNINDEX trên Notion.",
      support: vnThesis?.support || "Đang cập nhật",
      resistance: vnThesis?.resistance || "Đang cập nhật",
      riskScore: risk,
    },
    modules: [
      {
        key: "scanner",
        label: "Quét Wyckoff",
        value: scanner ? `${bullishScans} mã tích cực` : "Chưa kết nối",
        detail: scanner ? `${completedScans}/${scans.length} scan hoàn tất trong snapshot mới nhất` : "Không đọc được Notion Daily Scanner",
        href: "/research/scanner",
        status: scanner?.providerHealth.currentProvider || "Notion",
      },
      {
        key: "signals",
        label: "Tín hiệu giao dịch",
        value: `${performance.open} đang mở`,
        detail: performance.winRate == null ? `${performance.closed} tín hiệu đã đóng` : `Win rate hậu kiểm ${performance.winRate.toFixed(1)}%`,
        href: "/research/signals",
        status: "Notion signals",
      },
      {
        key: "fa",
        label: "FA & Định giá",
        value: `${attractive} mã hấp dẫn`,
        detail: `${highQuality} doanh nghiệp đạt chất lượng A/A- trên snapshot Top 100`,
        href: "/research/fa",
        status: `Snapshot ${FA_SCREEN_SNAPSHOT_DATE}`,
      },
      {
        key: "research",
        label: "Luận điểm chuyên sâu",
        value: `${stockTheses} thesis`,
        detail: vnThesis?.marketRegime ? `Market regime: ${vnThesis.marketRegime}` : "Canonical thesis và analysis log trên Notion",
        href: "/research",
        status: research?.connection.notionLive ? "Notion live" : "Notion unavailable",
      },
    ],
    faSnapshotDate: FA_SCREEN_SNAPSHOT_DATE,
  }
}
