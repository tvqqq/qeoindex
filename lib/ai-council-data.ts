import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildCouncilStock,
  type AiCouncilStock,
  type CouncilRatingEvidence,
  type CouncilRiskStance,
  type CouncilSignal,
  type CouncilTimeframe,
  type CouncilWyckoffEvidence,
} from "@/lib/ai-council-model"
import type { AiCouncilPromptStockSnapshot } from "@/lib/ai-council-prompt-evidence"
import { getCanonicalUniverse } from "@/lib/market-universe"

export type { AiCouncilPromptStockSnapshot }

export type AiCouncilStockSnapshot = AiCouncilStock & {
  evidenceHash: string
  promptEvidence?: AiCouncilPromptStockSnapshot
}

export interface AiCouncilOutcomeHistory {
  status: "pending" | "partial" | "matured" | "unavailable"
  sessionsObserved: number
  evaluatedThroughDate: string | null
  return1dPct: number | null
  return5dPct: number | null
  return20dPct: number | null
  mfe20dPct: number | null
  mae20dPct: number | null
  directionCorrect5d: boolean | null
}

export interface AiCouncilHistoryEntry {
  id: string
  ticker: string
  asOfDate: string
  signal: CouncilSignal
  councilScore: number
  confidence: number
  consensus: number
  riskStatus: CouncilRiskStance
  price: number | null
  policyVersion: string
  evidenceHash: string
  createdAt: string
  outcome: AiCouncilOutcomeHistory | null
}

export interface AiCouncilData {
  generatedAt: string
  ratingDate: string | null
  mode: "evidence-ensemble-v1"
  message: string
  historyMessage: string
  stocks: AiCouncilStockSnapshot[]
  history: AiCouncilHistoryEntry[]
}

type RatingRow = {
  ticker: string
  company_name: string | null
  sector: string | null
  exchange: string | null
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

type HistoryRunRow = {
  id: string
  ticker: string
  as_of_date: string
  signal: string
  council_score: number
  confidence: number
  consensus: number
  risk_status: string
  price: number | null
  policy_version: string
  evidence_hash: string
  created_at: string
}

type HistoryOutcomeRow = {
  run_id: string
  outcome_status: string
  sessions_observed: number
  evaluated_through_date: string | null
  return_1d_pct: number | null
  return_5d_pct: number | null
  return_20d_pct: number | null
  mfe_20d_pct: number | null
  mae_20d_pct: number | null
  direction_correct_5d: boolean | null
}

const TIMEFRAME_ORDER: CouncilTimeframe[] = ["1W", "1D", "4H", "1H"]

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

function metricGroup(metrics: unknown, group: string) { return record(record(metrics)[group]) }
function metricNumber(metrics: unknown, group: string, key: string) { return nullableNumber(metricGroup(metrics, group)[key]) }
function metricString(metrics: unknown, group: string, key: string) { return nullableString(metricGroup(metrics, group)[key]) }

function normalizeRating(row: RatingRow, rank: number | null): CouncilRatingEvidence {
  return {
    ticker: row.ticker,
    companyName: row.company_name || row.ticker,
    sector: row.sector || "Chưa phân ngành",
    exchange: row.exchange,
    rank,
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

function isCouncilTimeframe(value: string): value is CouncilTimeframe { return value === "1W" || value === "1D" || value === "4H" || value === "1H" }

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]))
}

function buildEvidenceHash(rating: CouncilRatingEvidence, snapshots: CouncilWyckoffEvidence[]) {
  const orderedSnapshots = [...snapshots].sort((left, right) => {
    const leftIndex = TIMEFRAME_ORDER.indexOf(left.timeframe)
    const rightIndex = TIMEFRAME_ORDER.indexOf(right.timeframe)
    return leftIndex - rightIndex || (left.barClosedAt || "").localeCompare(right.barClosedAt || "")
  })
  return createHash("sha256").update(JSON.stringify(canonicalize({ rating, snapshots: orderedSnapshots })), "utf8").digest("hex")
}

function isCouncilSignal(value: string): value is CouncilSignal { return value === "BUY" || value === "BUY_ON_CONFIRMATION" || value === "WAIT" || value === "REDUCE" || value === "SELL" }
function isCouncilRisk(value: string): value is CouncilRiskStance { return value === "approve" || value === "caution" || value === "veto" }

async function loadCouncilHistory(supabase: SupabaseClient, tickers: string[]) {
  if (!tickers.length) return { history: [] as AiCouncilHistoryEntry[], message: "" }
  const runsResult = await supabase
    .from("ai_council_runs")
    .select("id,ticker,as_of_date,signal,council_score,confidence,consensus,risk_status,price,policy_version,evidence_hash,created_at")
    .in("ticker", tickers)
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1600)
  if (runsResult.error) return { history: [] as AiCouncilHistoryEntry[], message: `Historical audit trail chưa sẵn sàng: ${runsResult.error.message}` }

  const runs = (runsResult.data || []) as HistoryRunRow[]
  const runIds = runs.map((run) => run.id)
  const outcomeRows: HistoryOutcomeRow[] = []
  for (let offset = 0; offset < runIds.length; offset += 100) {
    const result = await supabase
      .from("ai_council_outcomes")
      .select("run_id,outcome_status,sessions_observed,evaluated_through_date,return_1d_pct,return_5d_pct,return_20d_pct,mfe_20d_pct,mae_20d_pct,direction_correct_5d")
      .in("run_id", runIds.slice(offset, offset + 100))
    if (result.error) return { history: [] as AiCouncilHistoryEntry[], message: `Council outcomes chưa đọc được: ${result.error.message}` }
    outcomeRows.push(...((result.data || []) as HistoryOutcomeRow[]))
  }

  const outcomeByRun = new Map(outcomeRows.map((row) => [row.run_id, row]))
  const perTicker = new Map<string, number>()
  const history: AiCouncilHistoryEntry[] = []
  for (const run of runs) {
    if (!isCouncilSignal(run.signal) || !isCouncilRisk(run.risk_status)) continue
    const seen = perTicker.get(run.ticker) || 0
    if (seen >= 8) continue
    perTicker.set(run.ticker, seen + 1)
    const outcome = outcomeByRun.get(run.id)
    history.push({
      id: run.id, ticker: run.ticker, asOfDate: run.as_of_date, signal: run.signal,
      councilScore: Number(run.council_score), confidence: Number(run.confidence), consensus: Number(run.consensus), riskStatus: run.risk_status,
      price: nullableNumber(run.price), policyVersion: run.policy_version, evidenceHash: run.evidence_hash, createdAt: run.created_at,
      outcome: outcome ? {
        status: (outcome.outcome_status === "partial" || outcome.outcome_status === "matured" || outcome.outcome_status === "unavailable") ? outcome.outcome_status : "pending",
        sessionsObserved: Number(outcome.sessions_observed || 0), evaluatedThroughDate: outcome.evaluated_through_date,
        return1dPct: nullableNumber(outcome.return_1d_pct), return5dPct: nullableNumber(outcome.return_5d_pct), return20dPct: nullableNumber(outcome.return_20d_pct),
        mfe20dPct: nullableNumber(outcome.mfe_20d_pct), mae20dPct: nullableNumber(outcome.mae_20d_pct), directionCorrect5d: outcome.direction_correct_5d,
      } : null,
    })
  }
  return {
    history,
    message: history.length ? "Persisted Council revisions are immutable; forward outcomes update as new published sessions arrive." : "Chưa có persisted Council run; cron sẽ bắt đầu tạo audit trail sau snapshot giao dịch kế tiếp.",
  }
}

export async function getAiCouncilData(
  supabase: SupabaseClient,
  options: { includeHistory?: boolean; includePromptEvidence?: boolean; ratingDate?: string } = {},
): Promise<AiCouncilData> {
  const generatedAt = new Date().toISOString()
  const universe = await getCanonicalUniverse()
  const universeTickers = universe.stocks.map((stock) => stock.ticker)
  const rankByTicker = new Map(universe.stocks.map((stock) => [stock.ticker, stock.rank] as const))
  let ratingDate = options.ratingDate?.trim() || ""

  if (!universeTickers.length) {
    return { generatedAt, ratingDate: null, mode: "evidence-ensemble-v1", message: "Canonical market universe chưa được publish.", historyMessage: "", stocks: [], history: [] }
  }

  if (!ratingDate) {
    const latest = await supabase
      .from("insights_stock_ratings")
      .select("as_of_date")
      .eq("is_published", true)
      .eq("source", "kfsp")
      .in("ticker", universeTickers)
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (latest.error || !latest.data?.as_of_date) {
      return {
        generatedAt, ratingDate: null, mode: "evidence-ensemble-v1",
        message: latest.error ? `Không đọc được rating snapshot: ${latest.error.message}` : "Chưa có canonical rating snapshot được publish.",
        historyMessage: "", stocks: [], history: [],
      }
    }
    ratingDate = latest.data.as_of_date as string
  }

  const ratingsResult = await supabase
    .from("insights_stock_ratings")
    .select("ticker,company_name,sector,exchange,price,price_change_pct,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,kfsp_stock_rs_score,kfsp_sector_rs_score,rs_short,rs_medium,kfsp_stock_rrg_state,kfsp_sector_rrg_state,weekly_change_pct,monthly_change_pct,beta,pe_ttm,pb_ttm,kfsp_metrics")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("as_of_date", ratingDate)
    .in("ticker", universeTickers)

  if (ratingsResult.error) {
    return { generatedAt, ratingDate, mode: "evidence-ensemble-v1", message: `Không đọc được canonical evidence: ${ratingsResult.error.message}`, historyMessage: "", stocks: [], history: [] }
  }

  const rowByTicker = new Map(((ratingsResult.data || []) as RatingRow[]).map((row) => [row.ticker, row] as const))
  const ratings = universeTickers.flatMap((ticker) => {
    const row = rowByTicker.get(ticker)
    return row ? [row] : []
  })
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
    .map((row) => {
      const rating = normalizeRating(row, rankByTicker.get(row.ticker) ?? null)
      const snapshots = wyckoffByTicker.get(row.ticker) || []
      const evidenceHash = buildEvidenceHash(rating, snapshots)
      const baseStock = buildCouncilStock(rating, snapshots)
      const promptEvidence: AiCouncilPromptStockSnapshot | undefined = options.includePromptEvidence
        ? { rating, snapshots, ratingDate, evidenceHash }
        : undefined
      return { ...baseStock, evidenceHash, ...(promptEvidence ? { promptEvidence } : {}) }
    })
    .sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) || right.councilScore - left.councilScore || left.ticker.localeCompare(right.ticker))

  const historyResult = options.includeHistory === false
    ? { history: [] as AiCouncilHistoryEntry[], message: "" }
    : await loadCouncilHistory(supabase, tickers)

  return {
    generatedAt,
    ratingDate,
    mode: "evidence-ensemble-v1",
    message: `Council V1 dùng independent evidence agents + deterministic Chair trên canonical universe ${universe.runId}, snapshot ${ratingDate}.${wyckoffMessage}`,
    historyMessage: historyResult.message,
    stocks,
    history: historyResult.history,
  }
}
