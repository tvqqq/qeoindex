import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDnseIndexCandleHistory } from "@/lib/dnse-index-candles"
import { FA_SCREEN_ROWS, FA_SCREEN_SNAPSHOT_DATE } from "@/lib/fa-screen-data"
import { getCanonicalUniverse } from "@/lib/market-universe"
import { getResearchOverviewData } from "@/lib/research-data"
import { getScannerData } from "@/lib/scanner-data"
import { getSignalUiData } from "@/lib/signal-data"
import { buildRecommendationPerformance } from "@/lib/signal-performance"
import { fetchTradingViewIndexes, type MarketIndexQuote } from "@/lib/tradingview-index"
import { getMarketCloseInsightData, type MarketCloseDashboardData } from "@/lib/market-insight-data"
import { loadMarketAiConclusion, type MarketAiConclusionView } from "@/lib/market-ai-conclusion-loader"
import { getSupabaseServerClient } from "@/lib/supabase/server"
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
  /** Compatibility names for the existing UI; semantics are canonical universe membership/rank. */
  isTop100: boolean
  top100Rank: number | null
  ratingScore: number
  price: number | null
  changePercent: number | null
  volume: number | null
  marketCapBillion: number | null
  score4m: number | null
  canslimScore: number | null
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
    technical: number | null
    momentum: number | null
    moneyFlow: number | null
    fundamental: number | null
  }
  scoreHistory: RatingModelSnapshot[]
}

export interface InsightsSectorSummary {
  sector: string
  stockCount: number
  /** Compatibility name; equals canonical-universe stock count in the sector. */
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
  ratingMode: "supabase" | "unavailable"
  ratingMessage: string
  modules: InsightsModuleSummary[]
  faSnapshotDate: string
  marketClose?: MarketCloseDashboardData | null
  marketAiConclusion?: MarketAiConclusionView
  bubbleStocks: InsightsBubbleStock[]
  bubbleAsOfDate: string | null
}

export interface InsightsBubbleStock {
  ticker: string
  companyName: string
  sector: string
  averageVolume50Sessions: number
  change1d: number | null
  change1w: number | null
  change1m: number | null
  change1y: number | null
}

type RatingDatabaseRow = {
  ticker: string
  company_name: string | null
  sector: string | null
  exchange: string | null
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

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function metricNumberFromGroups(groups: KfspMetricGroups, key: string) {
  for (const group of Object.values(groups)) {
    const value = group?.[key]
    const parsed = nullableNumber(value)
    if (parsed != null) return parsed
  }
  return null
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

function buildSectorSummaries(source: RatingDatabaseRow[]): InsightsSectorSummary[] {
  const groups = new Map<string, RatingDatabaseRow[]>()
  for (const candidate of source) {
    const sector = candidate.sector || "Chưa phân ngành"
    groups.set(sector, [...(groups.get(sector) || []), candidate])
  }
  return [...groups].map(([sector, rows]) => ({
    sector,
    stockCount: rows.length,
    top100Count: rows.length,
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
    asOfDate: row.asOfDate,
    ratingScore: row.ratingScore,
    score4m: row.score4m,
    canslimScore: row.canslimScore,
    pricePotential: row.pricePotential,
    rsShort: row.rsShort,
    rsMedium: row.rsMedium,
    stockRrgState: row.stockRrgState,
    sectorRrgState: row.sectorRrgState,
    rsi14: row.rsi14,
    weeklyChangePercent: row.weeklyChangePercent,
    monthlyChangePercent: row.monthlyChangePercent,
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
        ratingScore: nullableNumber(row.kfsp_composite_score),
        score4m: nullableNumber(row.kfsp_score_4m),
        canslimScore: nullableNumber(row.kfsp_canslim_score),
        pricePotential: row.kfsp_price_potential,
        rsShort: nullableNumber(row.rs_short),
        rsMedium: nullableNumber(row.rs_medium),
        stockRrgState: row.kfsp_stock_rrg_state,
        sectorRrgState: row.kfsp_sector_rrg_state,
        rsi14: nullableNumber(row.rsi_14),
        weeklyChangePercent: nullableNumber(row.weekly_change_pct),
        monthlyChangePercent: nullableNumber(row.monthly_change_pct),
        beta: nullableNumber(row.beta),
      }
      history.set(row.ticker, [...(history.get(row.ticker) || []), snapshot])
    }
  }
  return history
}

function componentScore(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(Math.max(0, Math.min(100, parsed))) : null
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

async function loadRatings(supabase: SupabaseClient): Promise<{ rows: InsightsRatingRow[]; sectorSummaries: InsightsSectorSummary[]; bubbleStocks: InsightsBubbleStock[]; bubbleAsOfDate: string | null; message: string }> {
  const universe = await getCanonicalUniverse()
  const tickers = universe.stocks.map((stock) => stock.ticker)
  const rankByTicker = new Map(universe.stocks.map((stock) => [stock.ticker, stock.rank] as const))
  if (!tickers.length) return { rows: [], sectorSummaries: [], bubbleStocks: [], bubbleAsOfDate: null, message: "Canonical Top Stocks universe chưa được publish." }

  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .in("ticker", tickers)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error) return { rows: [], sectorSummaries: [], bubbleStocks: [], bubbleAsOfDate: null, message: `Supabase rating chưa sẵn sàng: ${latest.error.message}` }
  if (!latest.data?.as_of_date) return { rows: [], sectorSummaries: [], bubbleStocks: [], bubbleAsOfDate: null, message: "Chưa có snapshot rating được cron công bố." }
  const latestDate = String(latest.data.as_of_date)
  const selection = "ticker,company_name,sector,exchange,price,price_change_pct,average_volume_50_sessions,market_cap_billion,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,kfsp_stock_rs_score,kfsp_sector_rs_score,kfsp_stock_rrg_state,kfsp_sector_rrg_state,rs_short,rs_medium,rsi_14,weekly_change_pct,monthly_change_pct,beta,pe_ttm,pb_ttm,kfsp_metrics,as_of_date,source"
  const chunks = Array.from({ length: Math.ceil(tickers.length / 100) }, (_, index) => tickers.slice(index * 100, index * 100 + 100))
  const responses = await Promise.all(chunks.map((chunk) => supabase
    .from("insights_stock_ratings")
    .select(selection)
    .eq("is_published", true)
    .eq("as_of_date", latestDate)
    .eq("source", "kfsp")
    .in("ticker", chunk)))
  const failed = responses.find((response) => response.error)
  if (failed?.error) return { rows: [], sectorSummaries: [], bubbleStocks: [], bubbleAsOfDate: null, message: `Không đọc được canonical rating: ${failed.error.message}` }

  const dbByTicker = new Map((responses.flatMap((response) => response.data || []) as RatingDatabaseRow[]).map((row) => [row.ticker, row] as const))
  const databaseRows = tickers.flatMap((ticker) => {
    const row = dbByTicker.get(ticker)
    return row ? [row] : []
  })

  let rows: InsightsRatingRow[] = databaseRows.flatMap((row) => {
    if (row.kfsp_composite_score == null) return []
    const ratingScore = componentScore(row.kfsp_composite_score)
    if (ratingScore == null) return []
    const technical = componentScore(row.kfsp_score_4m)
    const momentum = componentScore(row.kfsp_stock_rs_score)
    const moneyFlow = componentScore(row.kfsp_sector_rs_score)
    const fundamental = componentScore(row.kfsp_canslim_score)
    const metricGroups = parseMetricGroups(row.kfsp_metrics)
    const metricRsi = metricGroups.technical?.rsi_14
    return [{
      ticker: row.ticker,
      companyName: row.company_name || (row.exchange ? `${row.ticker} · ${row.exchange}` : row.ticker),
      sector: row.sector || "Chưa phân ngành",
      industryGroup: row.sector || "Chưa phân ngành",
      exchange: row.exchange,
      isTop100: true,
      top100Rank: rankByTicker.get(row.ticker) ?? null,
      ratingScore,
      price: nullableNumber(row.price),
      changePercent: nullableNumber(row.price_change_pct),
      volume: nullableNumber(row.average_volume_50_sessions),
      marketCapBillion: nullableNumber(row.market_cap_billion),
      score4m: technical,
      canslimScore: fundamental,
      pricePotential: row.kfsp_price_potential,
      rsShort: nullableNumber(row.rs_short),
      rsMedium: nullableNumber(row.rs_medium),
      stockRrgState: row.kfsp_stock_rrg_state,
      sectorRrgState: row.kfsp_sector_rrg_state,
      rsi14: row.rsi_14 == null ? (typeof metricRsi === "number" || typeof metricRsi === "string" ? metricRsi : null) : Number(row.rsi_14),
      weeklyChangePercent: nullableNumber(row.weekly_change_pct),
      monthlyChangePercent: nullableNumber(row.monthly_change_pct),
      beta: nullableNumber(row.beta),
      peTtm: nullableNumber(row.pe_ttm),
      pbTtm: nullableNumber(row.pb_ttm),
      asOfDate: row.as_of_date,
      provider: row.source,
      metricGroups,
      scoreComponents: { technical, momentum, moneyFlow, fundamental },
      scoreHistory: [],
    }]
  }).sort((left, right) => (left.top100Rank ?? 999) - (right.top100Rank ?? 999))

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

  const sectorSummaries = buildSectorSummaries(databaseRows)
  const bubbleStocks: InsightsBubbleStock[] = databaseRows
    .flatMap((row) => {
      const volume = nullableNumber(row.average_volume_50_sessions)
      if (volume == null) return []
      const metrics = parseMetricGroups(row.kfsp_metrics)
      return [{
        ticker: row.ticker,
        companyName: row.company_name || row.ticker,
        sector: row.sector || "Chưa phân ngành",
        averageVolume50Sessions: volume,
        change1d: nullableNumber(row.price_change_pct),
        change1w: nullableNumber(row.weekly_change_pct) ?? metricNumberFromGroups(metrics, "price_change_1w_pct"),
        change1m: nullableNumber(row.monthly_change_pct) ?? metricNumberFromGroups(metrics, "price_change_1m_pct"),
        change1y: metricNumberFromGroups(metrics, "price_change_1y_pct"),
      }]
    })
    .sort((left, right) => right.averageVolume50Sessions - left.averageVolume50Sessions || left.ticker.localeCompare(right.ticker))

  const missingDetails = tickers.length - databaseRows.length
  const missingSuffix = missingDetails ? ` · thiếu ${missingDetails} rating rows` : ""
  return {
    rows,
    message: `${rows.length}/${tickers.length} mã canonical · ${sectorSummaries.length} ngành · snapshot ${latestDate}${missingSuffix}`,
    sectorSummaries,
    bubbleStocks,
    bubbleAsOfDate: latestDate,
  }
}

function settledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null
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
  const marketAiConclusion = await loadMarketAiConclusion(getSupabaseServerClient(), marketClose)
  const vnindex = indexes?.VNINDEX ?? null
  const ratings = ratingResult?.rows ?? []
  const bubbleStocks = ratingResult?.bubbleStocks ?? []
  const bubbleAsOfDate = ratingResult?.bubbleAsOfDate ?? null
  const sectorSummaries = ratingResult?.sectorSummaries ?? []
  const unavailable = !ratingResult?.rows.length
  const scans = scanner ? Object.values(scanner.latestScans) : []
  const completedScans = scans.filter((row) => row.status === "Complete").length
  const bullishScans = scans.filter((row) => row.taBias === "Bullish").length
  const performance = buildRecommendationPerformance(signals?.recommendations ?? [])
  const attractive = FA_SCREEN_ROWS.filter((row) => row.valuation === "Rất hấp dẫn" || row.valuation === "Hấp dẫn").length
  const highQuality = FA_SCREEN_ROWS.filter((row) => row.grade === "A" || row.grade === "A-").length
  const vnThesis = research?.theses.find((row) => row.ticker === "VNINDEX")
  const stockTheses = research?.theses.filter((row) => row.ticker !== "VNINDEX").length ?? 0

  return {
    generatedAt: new Date().toISOString(),
    vnindex,
    vnindexSeries: candleHistory?.bars.map((bar) => bar.close).slice(-64) ?? [],
    ratings,
    sectorSummaries,
    ratingMode: unavailable ? "unavailable" : "supabase",
    ratingMessage: unavailable ? `${ratingResult?.message ?? "Rating backend chưa có dữ liệu."} Không hiển thị dữ liệu mẫu.` : ratingResult?.message ?? "Supabase rating",
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
        detail: `${highQuality} doanh nghiệp đạt chất lượng A/A- trên snapshot nghiên cứu`,
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
    marketAiConclusion,
    bubbleStocks,
    bubbleAsOfDate,
  }
}