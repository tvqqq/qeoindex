import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildCouncilStock,
  type AiCouncilStock,
  type CouncilRatingEvidence,
  type CouncilTimeframe,
  type CouncilWyckoffEvidence,
} from "@/lib/ai-council-model"

export interface AiCouncilData {
  generatedAt: string
  ratingDate: string | null
  mode: "evidence-ensemble-v1"
  message: string
  stocks: AiCouncilStock[]
}

type RatingRow = {
  ticker: string
  company_name: string | null
  sector: string | null
  exchange: string | null
  top100_rank: number | null
  price: number | null
  price_change_pct: number | null
  kfsp_composite_score: number | null
  kfsp_score_4m: number | null
  kfsp_canslim_score: number | null
  kfsp_price_potential: string | null
  kfsp_stock_rs_score: number | null
  kfsp_sector_rs_score: number | null
  rs_short: number | null
  rs_medium: number | null
  kfsp_stock_rrg_state: string | null
  kfsp_sector_rrg_state: string | null
  weekly_change_pct: number | null
  monthly_change_pct: number | null
  beta: number | null
  pe_ttm: number | null
  pb_ttm: number | null
  kfsp_metrics: unknown
}

type WyckoffRow = {
  ticker: string
  timeframe: string
  bar_closed_at: string | null
  phase: string | null
  wyckoff_state: string | null
  ta_bias: string | null
  confidence: string | null
  bull_probability: number | null
  base_probability: number | null
  bear_probability: number | null
  support: string | null
  resistance: string | null
  confirmation: string | null
  invalidation: string | null
  what_changed: string | null
  technical: unknown
  evidence: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableString(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function metricGroup(metrics: unknown, group: string) {
  return record(record(metrics)[group])
}

function metricNumber(metrics: unknown, group: string, key: string) {
  return nullableNumber(metricGroup(metrics, group)[key])
}

function metricString(metrics: unknown, group: string, key: string) {
  return nullableString(metricGroup(metrics, group)[key])
}

function normalizeRating(row: RatingRow): CouncilRatingEvidence {
  return {
    ticker: row.ticker,
    companyName: row.company_name || row.ticker,
    sector: row.sector || "Chưa phân ngành",
    exchange: row.exchange,
    rank: row.top100_rank,
    price: nullableNumber(row.price),
    changePct: nullableNumber(row.price_change_pct),
    ratingScore: nullableNumber(row.kfsp_composite_score),
    score4m: nullableNumber(row.kfsp_score_4m),
    canslimScore: nullableNumber(row.kfsp_canslim_score),
    pricePotential: row.kfsp_price_potential,
    stockRsScore: nullableNumber(row.kfsp_stock_rs_score),
    sectorRsScore: nullableNumber(row.kfsp_sector_rs_score),
    rsShort: nullableNumber(row.rs_short),
    rsMedium: nullableNumber(row.rs_medium),
    stockRrgState: row.kfsp_stock_rrg_state,
    sectorRrgState: row.kfsp_sector_rrg_state,
    weeklyChangePct: nullableNumber(row.weekly_change_pct),
    monthlyChangePct: nullableNumber(row.monthly_change_pct),
    beta: nullableNumber(row.beta),
    peTtm: nullableNumber(row.pe_ttm),
    pbTtm: nullableNumber(row.pb_ttm),
    fundamentals: {
      revenueGrowthPct: metricNumber(row.kfsp_metrics, "fundamentals", "net_revenue_growth_pct"),
      netIncomeGrowthPct: metricNumber(row.kfsp_metrics, "fundamentals", "net_income_growth_pct"),
      roePct: metricNumber(row.kfsp_metrics, "fundamentals", "roe_ttm_pct"),
      roaPct: metricNumber(row.kfsp_metrics, "fundamentals", "roa_ttm_pct"),
      netMarginPct: metricNumber(row.kfsp_metrics, "fundamentals", "net_margin_ttm_pct"),
    },
    technical: {
      priceVsSma10Pct: metricNumber(row.kfsp_metrics, "technical", "price_vs_sma10_pct"),
      priceVsSma20Pct: metricNumber(row.kfsp_metrics, "technical", "price_vs_sma20_pct"),
      priceVsSma50Pct: metricNumber(row.kfsp_metrics, "technical", "price_vs_sma50_pct"),
      priceVsSma100Pct: metricNumber(row.kfsp_metrics, "technical", "price_vs_sma100_pct"),
      priceVsSma200Pct: metricNumber(row.kfsp_metrics, "technical", "price_vs_sma200_pct"),
      macdVsSignal: metricString(row.kfsp_metrics, "technical", "macd_vs_signal"),
    },
    liquidity: {
      volume1d: metricNumber(row.kfsp_metrics, "liquidity", "volume_1d"),
      averageVolume10d: metricNumber(row.kfsp_metrics, "liquidity", "average_volume_10d"),
      averageVolume20d: metricNumber(row.kfsp_metrics, "liquidity", "average_volume_20d"),
      averageVolume50d: metricNumber(row.kfsp_metrics, "liquidity", "average_volume_50d"),
      volumeVsPreviousSessionPct: metricNumber(row.kfsp_metrics, "liquidity", "volume_vs_previous_session_pct"),
      tradedValueVsPreviousSessionPct: metricNumber(row.kfsp_metrics, "liquidity", "traded_value_vs_previous_session_pct"),
    },
    flow: {
      netForeignTradingBillion: metricNumber(row.kfsp_metrics, "general", "net_foreign_trading_billion"),
      netProprietaryTradingBillion: metricNumber(row.kfsp_metrics, "general", "net_proprietary_trading_billion"),
    },
  }
}

function isCouncilTimeframe(value: string): value is CouncilTimeframe {
  return value === "1W" || value === "1D" || value === "4H" || value === "1H"
}

function normalizeWyckoff(row: WyckoffRow): CouncilWyckoffEvidence | null {
  if (!isCouncilTimeframe(row.timeframe)) return null
  const technical = record(row.technical)
  const evidence = record(row.evidence)
  return {
    timeframe: row.timeframe,
    barClosedAt: row.bar_closed_at,
    phase: row.phase || "Unclassified",
    state: row.wyckoff_state || "",
    bias: row.ta_bias || "Neutral",
    confidence: row.confidence || "LOW",
    bullProbability: nullableNumber(row.bull_probability),
    baseProbability: nullableNumber(row.base_probability),
    bearProbability: nullableNumber(row.bear_probability),
    support: row.support || "",
    resistance: row.resistance || "",
    confirmation: row.confirmation || "",
    invalidation: row.invalidation || "",
    whatChanged: row.what_changed || "",
    price: nullableNumber(technical.price),
    changePct: nullableNumber(technical.changePct),
    relVolume: nullableNumber(technical.relVolume),
    provider: nullableString(evidence.provider) || "Unknown",
    providerDetail: nullableString(evidence.providerDetail) || "",
    derived: typeof evidence.derived === "boolean" ? evidence.derived : null,
  }
}

export async function getAiCouncilData(supabase: SupabaseClient): Promise<AiCouncilData> {
  const generatedAt = new Date().toISOString()
  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error || !latest.data?.as_of_date) {
    return {
      generatedAt,
      ratingDate: null,
      mode: "evidence-ensemble-v1",
      message: latest.error ? `Không đọc được rating snapshot: ${latest.error.message}` : "Chưa có Top 100 rating snapshot được publish.",
      stocks: [],
    }
  }

  const ratingDate = latest.data.as_of_date as string
  const ratingsResult = await supabase
    .from("insights_stock_ratings")
    .select("ticker,company_name,sector,exchange,top100_rank,price,price_change_pct,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,kfsp_stock_rs_score,kfsp_sector_rs_score,rs_short,rs_medium,kfsp_stock_rrg_state,kfsp_sector_rrg_state,weekly_change_pct,monthly_change_pct,beta,pe_ttm,pb_ttm,kfsp_metrics")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .eq("as_of_date", ratingDate)
    .order("top100_rank", { ascending: true, nullsFirst: false })
    .order("ticker", { ascending: true })

  if (ratingsResult.error) {
    return {
      generatedAt,
      ratingDate,
      mode: "evidence-ensemble-v1",
      message: `Không đọc được Top 100 evidence: ${ratingsResult.error.message}`,
      stocks: [],
    }
  }

  const ratings = (ratingsResult.data || []) as RatingRow[]
  const tickers = ratings.map((row) => row.ticker)
  let wyckoffRows: WyckoffRow[] = []
  let wyckoffMessage = ""

  if (tickers.length) {
    const wyckoffResult = await supabase
      .from("wyckoff_latest_by_timeframe")
      .select("ticker,timeframe,bar_closed_at,phase,wyckoff_state,ta_bias,confidence,bull_probability,base_probability,bear_probability,support,resistance,confirmation,invalidation,what_changed,technical,evidence")
      .in("ticker", tickers)
      .in("timeframe", ["1W", "1D", "4H", "1H"])

    if (wyckoffResult.error) wyckoffMessage = ` Wyckoff snapshot chưa đầy đủ: ${wyckoffResult.error.message}`
    else wyckoffRows = (wyckoffResult.data || []) as WyckoffRow[]
  }

  const wyckoffByTicker = new Map<string, CouncilWyckoffEvidence[]>()
  for (const row of wyckoffRows) {
    const normalized = normalizeWyckoff(row)
    if (!normalized) continue
    wyckoffByTicker.set(row.ticker, [...(wyckoffByTicker.get(row.ticker) || []), normalized])
  }

  const stocks = ratings
    .map((row) => buildCouncilStock(normalizeRating(row), wyckoffByTicker.get(row.ticker) || []))
    .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) || right.councilScore - left.councilScore || left.ticker.localeCompare(right.ticker))

  return {
    generatedAt,
    ratingDate,
    mode: "evidence-ensemble-v1",
    message: `Council V1 dùng independent evidence agents + deterministic Chair trên snapshot ${ratingDate}.${wyckoffMessage}`,
    stocks,
  }
}
