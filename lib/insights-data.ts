import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDnseIndexCandleHistory } from "@/lib/dnse-index-candles"
import { FA_SCREEN_ROWS, FA_SCREEN_SNAPSHOT_DATE } from "@/lib/fa-screen-data"
import { getResearchOverviewData } from "@/lib/research-data"
import { getScannerData } from "@/lib/scanner-data"
import { getSignalUiData } from "@/lib/signal-data"
import { buildRecommendationPerformance } from "@/lib/signal-performance"
import { fetchTradingViewIndexes, type MarketIndexQuote } from "@/lib/tradingview-index"
import { getMarketCloseInsightData, type MarketCloseDashboardData } from "@/lib/market-insight-data"
import type { RatingModelSnapshot } from "@/lib/insights-rating-model"
import { KFSP_GROUPS, type KfspGroupKey } from "@/supabase/functions/_shared/kfsp-catalog"

export type KfspMetricValue = string | number | boolean | null
export type KfspMetricGroups = Partial<Record<KfspGroupKey, Record<string, KfspMetricValue>>>

export interface InsightsRatingRow {
  ticker: string
  companyName: string
  sector: string
  industryGroup: string
  exchange: string | null
  isTop100: boolean
  top100Rank: number | null
  ratingScore: number
  price: number | null
  changePercent: number | null
  volume: number | null
  marketCapBillion: number | null
  score4m: number
  canslimScore: number
  pricePotential: string | null
  rsShort: number | null
  rsMedium: number | null
  stockRrgState: string | null
  sectorRrgState: string | null
  rsi14: number | string | null
  weeklyChangePercent: number | null
  monthlyChangePercent: number | null
  beta: number | null
  peTtm: number | null
  pbTtm: number | null
  asOfDate: string
  provider: string
  metricGroups: KfspMetricGroups
  scoreComponents: {
    technical: number
    momentum: number
    moneyFlow: number
    fundamental: number
  }
  scoreHistory: RatingModelSnapshot[]
}

export interface InsightsSectorSummary {
  sector: string
  stockCount: number
  top100Count: number
  averagePrice: number | null
  totalMarketCapBillion: number
  averageCanslimScore: number | null
  averageScore4m: number | null
  pricePotentialUpCount: number
  averageRsShort: number | null
  averageRsMedium: number | null
  dominantRrgState: string | null
  averageWeeklyChangePercent: number | null
  averageMonthlyChangePercent: number | null
  averageRatingScore: number | null
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
  sectorSummaries: InsightsSectorSummary[]
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
  marketClose?: MarketCloseDashboardData | null
}

type RatingDatabaseRow = {
  ticker: string
  company_name: string | null
  sector: string | null
  industry_group: string | null
  exchange: string | null
  is_top100: boolean
  top100_rank: number | null
  average_volume_50_sessions: number | null
  market_cap_billion: number | null
  kfsp_composite_score: number | null
  kfsp_score_4m: number | null
  kfsp_canslim_score: number | null
  kfsp_price_potential: string | null
  kfsp_stock_rs_score: number | null
  kfsp_sector_rs_score: number | null
  kfsp_stock_rrg_state: string | null
  kfsp_sector_rrg_state: string | null
  rs_short: number | null
  rs_medium: number | null
  rsi_14: number | null
  weekly_change_pct: number | null
  monthly_change_pct: number | null
  beta: number | null
  pe_ttm: number | null
  pb_ttm: number | null
  kfsp_metrics: unknown
  price: number | null
  price_change_pct: number | null
  as_of_date: string
  source: string
}

type SectorDatabaseRow = Pick<RatingDatabaseRow,
  "ticker" | "sector" | "is_top100" | "price" | "market_cap_billion" |
  "kfsp_composite_score" | "kfsp_score_4m" | "kfsp_canslim_score" | "kfsp_price_potential" |
  "rs_short" | "rs_medium" | "kfsp_sector_rrg_state" | "weekly_change_pct" | "monthly_change_pct"
>

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value != null)
  return valid.length ? valid.reduce((total, value) => total + value, 0) / valid.length : null
}

function dominant(values: Array<string | null>) {
  const counts = new Map<string, number>()
  values.forEach((value) => { if (value) counts.set(value, (counts.get(value) || 0) + 1) })
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "vi"))[0]?.[0] ?? null
}

function buildSectorSummaries(source: unknown[]): InsightsSectorSummary[] {
  const groups = new Map<string, SectorDatabaseRow[]>()
  for (const candidate of source as SectorDatabaseRow[]) {
    const sector = candidate.sector || "Chưa phân ngành"
    groups.set(sector, [...(groups.get(sector) || []), candidate])
  }
  return [...groups].map(([sector, rows]) => ({
    sector,
    stockCount: rows.length,
    top100Count: rows.filter((row) => row.is_top100).length,
    averagePrice: average(rows.map((row) => nullableNumber(row.price))),
    totalMarketCapBillion: rows.reduce((total, row) => total + (nullableNumber(row.market_cap_billion) || 0), 0),
    averageCanslimScore: average(rows.map((row) => nullableNumber(row.kfsp_canslim_score))),
    averageScore4m: average(rows.map((row) => nullableNumber(row.kfsp_score_4m))),
    pricePotentialUpCount: rows.filter((row) => row.kfsp_price_potential?.startsWith("Tăng")).length,
    averageRsShort: average(rows.map((row) => nullableNumber(row.rs_short))),
    averageRsMedium: average(rows.map((row) => nullableNumber(row.rs_medium))),
    dominantRrgState: dominant(rows.map((row) => row.kfsp_sector_rrg_state)),
    averageWeeklyChangePercent: average(rows.map((row) => nullableNumber(row.weekly_change_pct))),
    averageMonthlyChangePercent: average(rows.map((row) => nullableNumber(row.monthly_change_pct))),
    averageRatingScore: average(rows.map((row) => nullableNumber(row.kfsp_composite_score))),
  })).sort((left, right) => (right.averageRatingScore || 0) - (left.averageRatingScore || 0))
}

function toHistorySnapshot(row: InsightsRatingRow): RatingModelSnapshot {
  return {
    asOfDate: row.asOfDate, ratingScore: row.ratingScore, score4m: row.score4m,
    canslimScore: row.canslimScore, pricePotential: row.pricePotential,
    rsShort: row.rsShort, rsMedium: row.rsMedium, stockRrgState: row.stockRrgState,
    sectorRrgState: row.sectorRrgState, rsi14: row.rsi14,
    weeklyChangePercent: row.weeklyChangePercent, monthlyChangePercent: row.monthlyChangePercent,
    beta: row.beta,
  }
}

async function loadHistoryDates(supabase: SupabaseClient, latestDate: string) {
  const current = new Date(`${latestDate}T00:00:00Z`)
  const targets = [1, 7, 30].map((days) => {
    const date = new Date(current)
    date.setUTCDate(date.getUTCDate() - days)
    return date.toISOString().slice(0, 10)
  })
  const results = await Promise.all(targets.map((target) => supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .lte("as_of_date", target)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()))
  return [...new Set(results.flatMap((result) => result.data?.as_of_date ? [result.data.as_of_date] : []))]
}

async function loadRatingHistory(supabase: SupabaseClient, tickers: string[], dates: string[]) {
  const selection = "ticker,as_of_date,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,rs_short,rs_medium,kfsp_stock_rrg_state,kfsp_sector_rrg_state,rsi_14,weekly_change_pct,monthly_change_pct,beta"
  const chunks = Array.from({ length: Math.ceil(tickers.length / 100) }, (_, index) => tickers.slice(index * 100, index * 100 + 100))
  const responses = await Promise.all(dates.flatMap((date) => chunks.map((chunk) => supabase
    .from("insights_stock_ratings")
    .select(selection)
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("as_of_date", date)
    .in("ticker", chunk))))
  const history = new Map<string, RatingModelSnapshot[]>()
  for (const response of responses) {
    if (response.error) continue
    for (const row of response.data || []) {
      const snapshot: RatingModelSnapshot = {
        asOfDate: row.as_of_date,
        ratingScore: nullableNumber(row.kfsp_composite_score), score4m: nullableNumber(row.kfsp_score_4m),
        canslimScore: nullableNumber(row.kfsp_canslim_score), pricePotential: row.kfsp_price_potential,
        rsShort: nullableNumber(row.rs_short), rsMedium: nullableNumber(row.rs_medium),
        stockRrgState: row.kfsp_stock_rrg_state, sectorRrgState: row.kfsp_sector_rrg_state,
        rsi14: nullableNumber(row.rsi_14), weeklyChangePercent: nullableNumber(row.weekly_change_pct),
        monthlyChangePercent: nullableNumber(row.monthly_change_pct), beta: nullableNumber(row.beta),
      }
      history.set(row.ticker, [...(history.get(row.ticker) || []), snapshot])
    }
  }
  return history
}

const RATING_PREVIEW: InsightsRatingRow[] = [
  makePreviewRating("FPT", "FPT Corporation", "Công nghệ", 94, 128.4, 2.8, 2_840_000, 96, 93, 92, 95),
  makePreviewRating("MWG", "Thế Giới Di Động", "Bán lẻ", 91, 64.8, 1.9, 5_170_000, 92, 94, 89, 88),
  makePreviewRating("VCB", "Vietcombank", "Ngân hàng", 88, 92.1, 1.3, 1_210_000, 86, 84, 88, 94),
  makePreviewRating("HPG", "Hòa Phát", "Thép", 84, 28.65, 1.1, 12_430_000, 87, 89, 85, 75),
  makePreviewRating("CTG", "VietinBank", "Ngân hàng", 82, 38.2, 0.7, 4_320_000, 78, 81, 83, 88),
  makePreviewRating("VHM", "Vinhomes", "Bất động sản", 76, 41.5, -0.4, 6_080_000, 72, 68, 77, 87),
  makePreviewRating("SSI", "SSI Securities", "Chứng khoán", 72, 31.25, -1.2, 8_660_000, 69, 65, 78, 76),
]

function makePreviewRating(ticker: string, companyName: string, sector: string, ratingScore: number, price: number, changePercent: number, volume: number, technical: number, momentum: number, moneyFlow: number, fundamental: number): InsightsRatingRow {
  return {
    ticker, companyName, sector, industryGroup: sector, exchange: "HOSE", isTop100: true, top100Rank: null,
    ratingScore, price, changePercent, volume, marketCapBillion: null,
    score4m: technical, canslimScore: fundamental, pricePotential: changePercent >= 0 ? "Tăng ↑" : "Giảm ↓",
    rsShort: momentum, rsMedium: moneyFlow, stockRrgState: "Dẫn dắt", sectorRrgState: "Dẫn dắt",
    rsi14: null, weeklyChangePercent: null, monthlyChangePercent: null,
    beta: null, peTtm: null, pbTtm: null, asOfDate: "", provider: "UI preview", metricGroups: {},
    scoreComponents: { technical, momentum, moneyFlow, fundamental },
    scoreHistory: [],
  }
}

function componentScore(value: unknown, fallback: number) {
  if (value == null || value === "") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : fallback
}

async function loadRatings(supabase: SupabaseClient): Promise<{ rows: InsightsRatingRow[]; sectorSummaries: InsightsSectorSummary[]; message: string }> {
  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error) return { rows: [], sectorSummaries: [], message: `Supabase rating chưa sẵn sàng: ${latest.error.message}` }
  if (!latest.data?.as_of_date) return { rows: [], sectorSummaries: [], message: "Chưa có snapshot rating được cron công bố." }
  const latestDate = latest.data.as_of_date

  const selection = "ticker,company_name,sector,industry_group,exchange,is_top100,top100_rank,price,price_change_pct,average_volume_50_sessions,market_cap_billion,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,kfsp_stock_rs_score,kfsp_sector_rs_score,kfsp_stock_rrg_state,kfsp_sector_rrg_state,rs_short,rs_medium,rsi_14,weekly_change_pct,monthly_change_pct,beta,pe_ttm,pb_ttm,kfsp_metrics,as_of_date,source"
  const baseQuery = () => supabase
    .from("insights_stock_ratings")
    .select(selection)
    .eq("is_published", true)
    .eq("as_of_date", latestDate)
    .eq("source", "kfsp")
    .order("kfsp_composite_score", { ascending: false, nullsFirst: false })
    .order("ticker", { ascending: true })

  const leanSelection = "ticker,sector,is_top100,price,market_cap_billion,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,rs_short,rs_medium,kfsp_sector_rrg_state,weekly_change_pct,monthly_change_pct"
  const leanQuery = (from: number, to: number) => supabase
    .from("insights_stock_ratings")
    .select(leanSelection)
    .eq("is_published", true)
    .eq("as_of_date", latestDate)
    .eq("source", "kfsp")
    .order("ticker", { ascending: true })
    .range(from, to)

  const [topRatings, top100, leanPageOne, leanPageTwo] = await Promise.all([
    baseQuery().limit(500),
    baseQuery().eq("is_top100", true).limit(100),
    leanQuery(0, 999),
    leanQuery(1000, 1999),
  ])
  if (topRatings.error) return { rows: [], sectorSummaries: [], message: `Không đọc được rating: ${topRatings.error.message}` }
  if (top100.error) return { rows: [], sectorSummaries: [], message: `Không đọc được Top 100: ${top100.error.message}` }
  if (leanPageOne.error || leanPageTwo.error) return { rows: [], sectorSummaries: [], message: `Không đọc được thống kê ngành: ${(leanPageOne.error || leanPageTwo.error)?.message}` }

  const databaseRows = [...new Map(
    ([...(topRatings.data || []), ...(top100.data || [])] as RatingDatabaseRow[])
      .map((row) => [row.ticker, row]),
  ).values()].sort((left, right) =>
    Number(right.kfsp_composite_score ?? -1) - Number(left.kfsp_composite_score ?? -1)
      || left.ticker.localeCompare(right.ticker),
  )

  let rows: InsightsRatingRow[] = databaseRows.flatMap((row) => {
    if (row.kfsp_composite_score == null) return []
    const ratingScore = componentScore(row.kfsp_composite_score, 0)
    const technical = componentScore(row.kfsp_score_4m, ratingScore)
    const momentum = componentScore(row.kfsp_stock_rs_score, ratingScore)
    const moneyFlow = componentScore(row.kfsp_sector_rs_score, ratingScore)
    const fundamental = componentScore(row.kfsp_canslim_score, ratingScore)
    const metricGroups = parseMetricGroups(row.kfsp_metrics)
    const metricRsi = metricGroups.technical?.rsi_14
    return [{
      ticker: row.ticker,
      companyName: row.company_name || (row.exchange ? `${row.ticker} · ${row.exchange}` : row.ticker),
      sector: row.sector || "Chưa phân ngành",
      industryGroup: row.industry_group || row.sector || "Chưa phân ngành",
      exchange: row.exchange,
      isTop100: Boolean(row.is_top100),
      top100Rank: row.top100_rank == null ? null : Number(row.top100_rank),
      ratingScore,
      price: row.price == null ? null : Number(row.price),
      changePercent: row.price_change_pct == null ? null : Number(row.price_change_pct),
      volume: row.average_volume_50_sessions == null ? null : Number(row.average_volume_50_sessions),
      marketCapBillion: row.market_cap_billion == null ? null : Number(row.market_cap_billion),
      score4m: technical,
      canslimScore: fundamental,
      pricePotential: row.kfsp_price_potential,
      rsShort: row.rs_short == null ? null : Number(row.rs_short),
      rsMedium: row.rs_medium == null ? null : Number(row.rs_medium),
      stockRrgState: row.kfsp_stock_rrg_state,
      sectorRrgState: row.kfsp_sector_rrg_state,
      rsi14: row.rsi_14 == null
        ? typeof metricRsi === "number" || typeof metricRsi === "string" ? metricRsi : null
        : Number(row.rsi_14),
      weeklyChangePercent: row.weekly_change_pct == null ? null : Number(row.weekly_change_pct),
      monthlyChangePercent: row.monthly_change_pct == null ? null : Number(row.monthly_change_pct),
      beta: row.beta == null ? null : Number(row.beta),
      peTtm: row.pe_ttm == null ? null : Number(row.pe_ttm),
      pbTtm: row.pb_ttm == null ? null : Number(row.pb_ttm),
      asOfDate: row.as_of_date,
      provider: row.source,
      metricGroups,
      scoreComponents: {
        technical,
        momentum,
        moneyFlow,
        fundamental,
      },
      scoreHistory: [],
    }]
  })

  const historyDates = await loadHistoryDates(supabase, latestDate)
  if (historyDates.length) {
    const historyByTicker = await loadRatingHistory(supabase, rows.map((row) => row.ticker), historyDates)
    rows = rows.map((row) => ({
      ...row,
      scoreHistory: [toHistorySnapshot(row), ...(historyByTicker.get(row.ticker) || [])]
        .filter((item, index, list) => list.findIndex((candidate) => candidate.asOfDate === item.asOfDate) === index)
        .sort((left, right) => right.asOfDate.localeCompare(left.asOfDate)),
    }))
  } else {
    rows = rows.map((row) => ({ ...row, scoreHistory: [toHistorySnapshot(row)] }))
  }

  const sectorSummaries = buildSectorSummaries([...(leanPageOne.data || []), ...(leanPageTwo.data || [])])
  return { rows, message: `${rows.length} mã chi tiết · ${sectorSummaries.length} ngành · snapshot ${latestDate}`, sectorSummaries }
}

function parseMetricGroups(value: unknown): KfspMetricGroups {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>
  return Object.fromEntries(KFSP_GROUPS.flatMap((group) => {
    const candidate = source[group.key]
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return []
    const metrics = Object.fromEntries(Object.entries(candidate as Record<string, unknown>).flatMap(([key, metric]) => {
      if (metric == null || ["string", "number", "boolean"].includes(typeof metric)) return [[key, metric as KfspMetricValue]]
      return []
    }))
    return [[group.key, metrics]]
  }))
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null
}

function summarizePreviewRows(rows: InsightsRatingRow[]): InsightsSectorSummary[] {
  return [...new Set(rows.map((row) => row.sector))].map((sector) => {
    const items = rows.filter((row) => row.sector === sector)
    return {
      sector, stockCount: items.length, top100Count: items.filter((row) => row.isTop100).length,
      averagePrice: average(items.map((row) => row.price)),
      totalMarketCapBillion: items.reduce((total, row) => total + (row.marketCapBillion || 0), 0),
      averageCanslimScore: average(items.map((row) => row.canslimScore)),
      averageScore4m: average(items.map((row) => row.score4m)),
      pricePotentialUpCount: items.filter((row) => row.pricePotential?.startsWith("Tăng")).length,
      averageRsShort: average(items.map((row) => row.rsShort)), averageRsMedium: average(items.map((row) => row.rsMedium)),
      dominantRrgState: dominant(items.map((row) => row.sectorRrgState)),
      averageWeeklyChangePercent: average(items.map((row) => row.weeklyChangePercent)),
      averageMonthlyChangePercent: average(items.map((row) => row.monthlyChangePercent)),
      averageRatingScore: average(items.map((row) => row.ratingScore)),
    }
  })
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
    getMarketCloseInsightData(supabase),
  ] as const)

  const indexes = settledValue(settled[0])
  const candleHistory = settledValue(settled[1])
  const ratingResult = settledValue(settled[2])
  const scanner = settledValue(settled[3])
  const signals = settledValue(settled[4])
  const research = settledValue(settled[5])
  const marketClose = settledValue(settled[6])
  const vnindex = indexes?.VNINDEX ?? null
  const ratings = ratingResult?.rows.length ? ratingResult.rows : RATING_PREVIEW
  const sectorSummaries = ratingResult?.sectorSummaries.length ? ratingResult.sectorSummaries : summarizePreviewRows(ratings)
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
    sectorSummaries,
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
    marketClose,
  }
}
