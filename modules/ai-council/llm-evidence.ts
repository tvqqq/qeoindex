import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import type { AiCouncilStockSnapshot } from "@/modules/ai-council/data"
import { AI_COUNCIL_POLICY_VERSION } from "@/modules/ai-council/persistence"

export const AI_COUNCIL_LLM_EVIDENCE_VERSION = "llm-evidence-fidelity-v1"

const TTAI_HISTORY_LIMIT = 8
const TTAI_QUERY_BATCH_SIZE = 25
const WYCKOFF_TIMEFRAMES = ["1W", "1D", "4H", "1H"] as const
const PROVIDER_GROUPS = ["overview", "general", "valuation", "fundamentals", "price_volatility", "price_range", "liquidity", "technical", "kfsp"] as const
const SOURCE_LIMITATIONS = [
  "TTAI/KFSP quarterly history is provider-synced and may be revised upstream; this immutable context freezes the values captured for the Council run.",
  "Wyckoff context uses the latest persisted 1W/1D/4H/1H snapshots available when the LLM evidence packet is frozen.",
  "This context is advisory-only and does not change the deterministic Council score, signal, calibration weights, or risk gate.",
] as const

type RatingEvidenceRow = {
  ticker: string
  as_of_date: string
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
  weekly_change_pct: number | null
  monthly_change_pct: number | null
  beta: number | null
  pe_ttm: number | null
  pb_ttm: number | null
  kfsp_metrics: unknown
}

type TtaiHistoryRow = {
  ticker: string
  period: string
  period_year: number
  period_quarter: number
  fourm_score: number | string | null
  canslim_score: number | string | null
  fourm_components: unknown
  canslim_components: unknown
  source: string
  fetched_at: string
}

type WyckoffEvidenceRow = {
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

type CouncilRunIdentityRow = { id: string; ticker: string; evidence_hash: string }
type PersistedContextRow = { run_id: string; ticker: string; context_hash: string; context_version: string; context_payload: unknown; source_limitations: unknown }

export interface CouncilLlmEvidenceContext {
  contextVersion: typeof AI_COUNCIL_LLM_EVIDENCE_VERSION
  ratingDate: string
  ticker: string
  providerSnapshot: {
    source: "kfsp"
    asOfDate: string
    companyName: string
    sector: string | null
    exchange: string | null
    rank: number | null
    price: number | null
    changePct: number | null
    compositeScore: number | null
    score4m: number | null
    canslimScore: number | null
    pricePotential: string | null
    stockRsScore: number | null
    sectorRsScore: number | null
    rsShort: number | null
    rsMedium: number | null
    weeklyChangePct: number | null
    monthlyChangePct: number | null
    beta: number | null
    peTtm: number | null
    pbTtm: number | null
    metrics: Record<string, unknown>
  } | null
  ttaiQuarterlyHistory: Array<{
    period: string; year: number; quarter: number; score4m: number | null; canslimScore: number | null
    fourmComponents: Record<string, unknown>; canslimComponents: Record<string, unknown>; source: string; fetchedAt: string
  }>
  wyckoffMtf: Array<{
    timeframe: string; barClosedAt: string | null; phase: string | null; state: string | null; bias: string | null; confidence: string | null
    bullProbability: number | null; baseProbability: number | null; bearProbability: number | null; support: string | null; resistance: string | null
    confirmation: string | null; invalidation: string | null; whatChanged: string | null; technical: Record<string, unknown>; evidence: Record<string, unknown>
  }>
  sourceLimitations: string[]
}

export interface CouncilLlmEvidenceHydrationResult {
  stocks: AiCouncilStockSnapshot[]
  contextVersion: typeof AI_COUNCIL_LLM_EVIDENCE_VERSION
  contextsBuilt: number
  contextsReused: number
  contextsPersisted: number
  missingRunIdentities: number
  ttaiRowsLoaded: number
  wyckoffRowsLoaded: number
  detail: string
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function nullableNumber(value: unknown) { if (value == null || value === "") return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]))
}
function contextHash(context: CouncilLlmEvidenceContext) { return createHash("sha256").update(JSON.stringify(canonicalize(context)), "utf8").digest("hex") }
function selectProviderMetrics(metrics: unknown) {
  const root = record(metrics)
  return Object.fromEntries(PROVIDER_GROUPS.filter((group) => root[group] != null).map((group) => [group, record(root[group])]))
}
function normalizedHistoryRow(row: TtaiHistoryRow) {
  return { period: row.period, year: Number(row.period_year), quarter: Number(row.period_quarter), score4m: nullableNumber(row.fourm_score), canslimScore: nullableNumber(row.canslim_score), fourmComponents: record(row.fourm_components), canslimComponents: record(row.canslim_components), source: row.source || "kfsp", fetchedAt: row.fetched_at }
}
function normalizedWyckoffRow(row: WyckoffEvidenceRow) {
  return { timeframe: row.timeframe, barClosedAt: row.bar_closed_at, phase: row.phase, state: row.wyckoff_state, bias: row.ta_bias, confidence: row.confidence, bullProbability: nullableNumber(row.bull_probability), baseProbability: nullableNumber(row.base_probability), bearProbability: nullableNumber(row.bear_probability), support: row.support, resistance: row.resistance, confirmation: row.confirmation, invalidation: row.invalidation, whatChanged: row.what_changed, technical: record(row.technical), evidence: record(row.evidence) }
}

function buildContext(params: { stock: AiCouncilStockSnapshot; ratingDate: string; rating: RatingEvidenceRow | null; ttaiRows: TtaiHistoryRow[]; wyckoffRows: WyckoffEvidenceRow[] }): CouncilLlmEvidenceContext {
  const { stock, ratingDate, rating, ttaiRows, wyckoffRows } = params
  const providerSnapshot = rating ? {
    source: "kfsp" as const,
    asOfDate: rating.as_of_date,
    companyName: rating.company_name || stock.companyName || stock.ticker,
    sector: rating.sector,
    exchange: rating.exchange,
    rank: stock.rank,
    price: nullableNumber(rating.price),
    changePct: nullableNumber(rating.price_change_pct),
    compositeScore: nullableNumber(rating.kfsp_composite_score),
    score4m: nullableNumber(rating.kfsp_score_4m),
    canslimScore: nullableNumber(rating.kfsp_canslim_score),
    pricePotential: rating.kfsp_price_potential,
    stockRsScore: nullableNumber(rating.kfsp_stock_rs_score),
    sectorRsScore: nullableNumber(rating.kfsp_sector_rs_score),
    rsShort: nullableNumber(rating.rs_short),
    rsMedium: nullableNumber(rating.rs_medium),
    weeklyChangePct: nullableNumber(rating.weekly_change_pct),
    monthlyChangePct: nullableNumber(rating.monthly_change_pct),
    beta: nullableNumber(rating.beta),
    peTtm: nullableNumber(rating.pe_ttm),
    pbTtm: nullableNumber(rating.pb_ttm),
    metrics: selectProviderMetrics(rating.kfsp_metrics),
  } : null
  const timeframeRank = new Map<string, number>(WYCKOFF_TIMEFRAMES.map((timeframe, index) => [timeframe, index]))
  return {
    contextVersion: AI_COUNCIL_LLM_EVIDENCE_VERSION,
    ratingDate,
    ticker: stock.ticker,
    providerSnapshot,
    ttaiQuarterlyHistory: ttaiRows.sort((left, right) => Number(right.period_year) - Number(left.period_year) || Number(right.period_quarter) - Number(left.period_quarter)).slice(0, TTAI_HISTORY_LIMIT).map(normalizedHistoryRow),
    wyckoffMtf: wyckoffRows.sort((left, right) => (timeframeRank.get(left.timeframe) ?? 99) - (timeframeRank.get(right.timeframe) ?? 99)).map(normalizedWyckoffRow),
    sourceLimitations: [...SOURCE_LIMITATIONS],
  }
}

function runKey(ticker: string, evidenceHash: string) { return `${ticker}|${evidenceHash}` }

async function loadRatingEvidence(supabase: SupabaseClient, ratingDate: string, tickers: string[]) {
  if (!tickers.length) return new Map<string, RatingEvidenceRow>()
  const rows: RatingEvidenceRow[] = []
  for (let offset = 0; offset < tickers.length; offset += 100) {
    const result = await supabase
      .from("insights_stock_ratings")
      .select("ticker,as_of_date,company_name,sector,exchange,price,price_change_pct,kfsp_composite_score,kfsp_score_4m,kfsp_canslim_score,kfsp_price_potential,kfsp_stock_rs_score,kfsp_sector_rs_score,rs_short,rs_medium,weekly_change_pct,monthly_change_pct,beta,pe_ttm,pb_ttm,kfsp_metrics")
      .eq("is_published", true)
      .eq("source", "kfsp")
      .eq("as_of_date", ratingDate)
      .in("ticker", tickers.slice(offset, offset + 100))
    if (result.error) throw new Error(`Load P4.3 KFSP evidence failed: ${result.error.message}`)
    rows.push(...((result.data || []) as RatingEvidenceRow[]))
  }
  return new Map(rows.map((row) => [row.ticker, row]))
}

async function loadTtaiEvidence(supabase: SupabaseClient, tickers: string[]) {
  const rows: TtaiHistoryRow[] = []
  for (let offset = 0; offset < tickers.length; offset += TTAI_QUERY_BATCH_SIZE) {
    const batch = tickers.slice(offset, offset + TTAI_QUERY_BATCH_SIZE)
    const result = await supabase.from("kfsp_ttai_quarterly_history").select("ticker,period,period_year,period_quarter,fourm_score,canslim_score,fourm_components,canslim_components,source,fetched_at").in("ticker", batch).order("period_year", { ascending: false }).order("period_quarter", { ascending: false }).limit(1000)
    if (result.error) throw new Error(`Load P4.3 TTAI history failed: ${result.error.message}`)
    rows.push(...((result.data || []) as TtaiHistoryRow[]))
  }
  const byTicker = new Map<string, TtaiHistoryRow[]>()
  for (const row of rows) byTicker.set(row.ticker, [...(byTicker.get(row.ticker) || []), row])
  return { byTicker, rowCount: rows.length }
}

async function loadWyckoffEvidence(supabase: SupabaseClient, tickers: string[]) {
  if (!tickers.length) return { byTicker: new Map<string, WyckoffEvidenceRow[]>(), rowCount: 0 }
  const result = await supabase.from("wyckoff_latest_by_timeframe").select("ticker,timeframe,bar_closed_at,phase,wyckoff_state,ta_bias,confidence,bull_probability,base_probability,bear_probability,support,resistance,confirmation,invalidation,what_changed,technical,evidence").in("ticker", tickers).in("timeframe", [...WYCKOFF_TIMEFRAMES])
  if (result.error) throw new Error(`Load P4.3 raw Wyckoff evidence failed: ${result.error.message}`)
  const rows = (result.data || []) as WyckoffEvidenceRow[]
  const byTicker = new Map<string, WyckoffEvidenceRow[]>()
  for (const row of rows) byTicker.set(row.ticker, [...(byTicker.get(row.ticker) || []), row])
  return { byTicker, rowCount: rows.length }
}

async function loadRunIdentities(supabase: SupabaseClient, ratingDate: string, stocks: AiCouncilStockSnapshot[]) {
  if (!stocks.length) return new Map<string, CouncilRunIdentityRow>()
  const result = await supabase.from("ai_council_runs").select("id,ticker,evidence_hash").eq("as_of_date", ratingDate).eq("policy_version", AI_COUNCIL_POLICY_VERSION).in("ticker", stocks.map((stock) => stock.ticker))
  if (result.error) throw new Error(`Load P4.3 Council run identities failed: ${result.error.message}`)
  return new Map(((result.data || []) as CouncilRunIdentityRow[]).map((row) => [runKey(row.ticker, row.evidence_hash), row]))
}

async function loadPersistedContexts(supabase: SupabaseClient, runIds: string[]) {
  if (!runIds.length) return new Map<string, PersistedContextRow>()
  const result = await supabase.from("ai_council_llm_evidence").select("run_id,ticker,context_hash,context_version,context_payload,source_limitations").in("run_id", runIds)
  if (result.error) throw new Error(`Load P4.3 frozen contexts failed: ${result.error.message}`)
  return new Map(((result.data || []) as PersistedContextRow[]).map((row) => [row.run_id, row]))
}

function contextCarrier(stock: AiCouncilStockSnapshot, hash: string, context: CouncilLlmEvidenceContext) {
  return { ...stock, llmEvidence: { purpose: "P4.3 context-only raw evidence. Do not reinterpret this as deterministic score input.", contextVersion: AI_COUNCIL_LLM_EVIDENCE_VERSION, contextHash: hash, rawEvidence: context, wyckoffContext: context.wyckoffMtf } }
}

export async function enrichCouncilStocksWithLlmEvidence(
  supabase: SupabaseClient,
  params: { ratingDate: string | null; stocks: AiCouncilStockSnapshot[] },
): Promise<CouncilLlmEvidenceHydrationResult> {
  const { ratingDate, stocks } = params
  if (!ratingDate || !stocks.length) {
    return { stocks, contextVersion: AI_COUNCIL_LLM_EVIDENCE_VERSION, contextsBuilt: 0, contextsReused: 0, contextsPersisted: 0, missingRunIdentities: stocks.length, ttaiRowsLoaded: 0, wyckoffRowsLoaded: 0, detail: "P4.3 evidence hydration skipped because no current Council rating date/stock set is available." }
  }

  const tickers = stocks.map((stock) => stock.ticker)
  const [ratings, ttai, wyckoff, runIdentities] = await Promise.all([
    loadRatingEvidence(supabase, ratingDate, tickers),
    loadTtaiEvidence(supabase, tickers),
    loadWyckoffEvidence(supabase, tickers),
    loadRunIdentities(supabase, ratingDate, stocks),
  ])

  const runIds = [...runIdentities.values()].map((row) => row.id)
  let persistedByRun = await loadPersistedContexts(supabase, runIds)
  const pendingRows: Array<Record<string, unknown>> = []
  const builtByRun = new Map<string, { hash: string; context: CouncilLlmEvidenceContext }>()
  let missingRunIdentities = 0

  for (const stock of stocks) {
    const run = runIdentities.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) { missingRunIdentities += 1; continue }
    if (persistedByRun.has(run.id)) continue
    const context = buildContext({ stock, ratingDate, rating: ratings.get(stock.ticker) || null, ttaiRows: [...(ttai.byTicker.get(stock.ticker) || [])], wyckoffRows: [...(wyckoff.byTicker.get(stock.ticker) || [])] })
    const hash = contextHash(context)
    builtByRun.set(run.id, { hash, context })
    pendingRows.push({ run_id: run.id, ticker: stock.ticker, rating_date: ratingDate, context_version: AI_COUNCIL_LLM_EVIDENCE_VERSION, context_hash: hash, context_payload: context, source_limitations: context.sourceLimitations })
  }

  if (pendingRows.length) {
    const persist = await supabase.from("ai_council_llm_evidence").upsert(pendingRows, { onConflict: "run_id", ignoreDuplicates: true })
    if (persist.error) throw new Error(`Persist P4.3 frozen contexts failed: ${persist.error.message}`)
    persistedByRun = await loadPersistedContexts(supabase, runIds)
  }

  let contextsReused = 0, contextsBuilt = 0
  const enrichedStocks = stocks.map((stock) => {
    const run = runIdentities.get(runKey(stock.ticker, stock.evidenceHash))
    if (!run) return stock
    const persisted = persistedByRun.get(run.id)
    if (persisted && persisted.context_version === AI_COUNCIL_LLM_EVIDENCE_VERSION) {
      const context = persisted.context_payload as CouncilLlmEvidenceContext
      if (builtByRun.has(run.id)) contextsBuilt += 1
      else contextsReused += 1
      return contextCarrier(stock, persisted.context_hash, context)
    }
    const built = builtByRun.get(run.id)
    if (!built) return stock
    contextsBuilt += 1
    return contextCarrier(stock, built.hash, built.context)
  })

  return {
    stocks: enrichedStocks,
    contextVersion: AI_COUNCIL_LLM_EVIDENCE_VERSION,
    contextsBuilt,
    contextsReused,
    contextsPersisted: pendingRows.length,
    missingRunIdentities,
    ttaiRowsLoaded: ttai.rowCount,
    wyckoffRowsLoaded: wyckoff.rowCount,
    detail: `P4.3 froze raw KFSP/TTAI/Wyckoff context for ${contextsBuilt + contextsReused} Council runs; deterministic scoring remained unchanged.`,
  }
}
