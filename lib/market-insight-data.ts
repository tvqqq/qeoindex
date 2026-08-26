import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  generateMarketObservations,
  type MarketObservation,
  type MarketObservationSnapshotInput,
} from "@/lib/market-insight-model"
import type {
  MarketRegime,
  QualityStatus,
  RotationState,
  LeaderCategory,
  EvidenceRef,
} from "@/supabase/functions/_shared/market-close-normalizer"

export interface MarketIndexCard {
  indexCode: "VNINDEX" | "VN30" | "HNX" | "UPCOM"
  value: number | null
  change: number | null
  changePct: number | null
  reference: number | null
  open: number | null
  high: number | null
  low: number | null
  matchedVolume: number | null
  tradedValue: number | null
  previousValueChangePct: number | null
  advances: number
  unchanged: number
  declines: number
  ceilings: number
  floors: number
  marketPe: number | null
  foreignBuyValue: number | null
  foreignSellValue: number | null
  foreignNetValue: number | null
  qualityStatus: QualityStatus
  evidenceRefs: EvidenceRef[]
  asOf: string
}

export interface MarketSectorRow {
  sectorKey: string
  timeWindow: "1d" | "5d" | "20d"
  displayName: string
  tradedValue: number | null
  averageChangePct: number | null
  advances: number
  unchanged: number
  declines: number
  rsScore: number | null
  rotationState: RotationState
  strengthRatio: number | null
  momentumRatio: number | null
  effortPct: number | null
  resultPct: number | null
  effortResultState: string | null
  qualityStatus: QualityStatus
  evidenceRefs: EvidenceRef[]
  asOf: string
}

export interface MarketLeaderItem {
  category: LeaderCategory
  rank: number
  ticker: string
  price: number | null
  changePct: number | null
  estimatedIndexPoints: number | null
  metricValue: number | null
  metricLabel: string | null
  qualityStatus: QualityStatus
  evidenceRefs: EvidenceRef[]
  asOf: string
}

export interface MarketHistoryPoint {
  sessionDate: string
  sentimentScore: number | null
  riskScore: number | null
  aboveMa10Pct: number | null
  aboveMa20Pct: number | null
  aboveMa50Pct: number | null
  aboveMa200Pct: number | null
  foreignNetValue: number | null
  proprietaryNetValue: number | null
  totalTradedValue: number | null
  vnindexClose: number | null
  vnindexChangePct: number | null
}

export interface MarketCloseDashboardData {
  sessionDate: string
  isStale: boolean
  staleMessage?: string
  asOf: string
  qualityStatus: QualityStatus
  marketRegime: MarketRegime
  dailySummary: {
    sentimentScore: number | null
    sentimentLabel: string | null
    riskScore: number | null
    riskLabel: string | null
    distributionCount: number | null
    distributionWindow: string
    aboveMa10Pct: number | null
    aboveMa20Pct: number | null
    aboveMa50Pct: number | null
    aboveMa200Pct: number | null
    foreignNetValue: number | null
    proprietaryNetValue: number | null
    otherFlowNetValue: number | null
    totalMatchedVolume: number | null
    totalTradedValue: number | null
    qualityStatus: QualityStatus
    missingFields: string[]
    evidenceRefs: EvidenceRef[]
    sourceTimestamp: string | null
  }
  indexes: MarketIndexCard[]
  sectors: MarketSectorRow[]
  leaders: MarketLeaderItem[]
  observations: MarketObservation[]
  history: MarketHistoryPoint[]
}

function vietnamTodayDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

export async function getMarketCloseInsightData(
  supabase: SupabaseClient,
  requestedDate?: string
): Promise<MarketCloseDashboardData | null> {
  const today = vietnamTodayDate()

  // 1. Query latest available session_date if not explicitly requested
  let targetDate = requestedDate
  if (!targetDate) {
    const latestDaily = await supabase
      .from("market_insight_daily")
      .select("session_date")
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latestDaily.data?.session_date) {
      targetDate = String(latestDaily.data.session_date)
    }
  }

  if (!targetDate) {
    return null
  }

  const isStale = targetDate < today

  // 2. Fetch daily, indexes, sectors, leaders in parallel
  const [dailyRes, indexesRes, sectorsRes, leadersRes, historyRes] = await Promise.all([
    supabase
      .from("market_insight_daily")
      .select("*")
      .eq("session_date", targetDate)
      .maybeSingle(),
    supabase
      .from("market_insight_indexes")
      .select("*")
      .eq("session_date", targetDate),
    supabase
      .from("market_insight_sectors")
      .select("*")
      .eq("session_date", targetDate),
    supabase
      .from("market_insight_leaders")
      .select("*")
      .eq("session_date", targetDate)
      .order("rank", { ascending: true }),
    supabase
      .from("market_insight_daily")
      .select("session_date,sentiment_score,risk_score,above_ma10_pct,above_ma20_pct,above_ma50_pct,above_ma200_pct,foreign_net_value,proprietary_net_value,total_traded_value")
      .lte("session_date", targetDate)
      .order("session_date", { ascending: false })
      .limit(20),
  ])

  const daily = dailyRes.data
  if (!daily) {
    return null
  }

  const indexes: MarketIndexCard[] = (indexesRes.data || []).map((row: Record<string, unknown>) => ({
    indexCode: row.index_code as MarketIndexCard["indexCode"],
    value: row.value != null ? Number(row.value) : null,
    change: row.change != null ? Number(row.change) : null,
    changePct: row.change_pct != null ? Number(row.change_pct) : null,
    reference: row.reference != null ? Number(row.reference) : null,
    open: row.open != null ? Number(row.open) : null,
    high: row.high != null ? Number(row.high) : null,
    low: row.low != null ? Number(row.low) : null,
    matchedVolume: row.matched_volume != null ? Number(row.matched_volume) : null,
    tradedValue: row.traded_value != null ? Number(row.traded_value) : null,
    previousValueChangePct: row.previous_value_change_pct != null ? Number(row.previous_value_change_pct) : null,
    advances: Number(row.advances || 0),
    unchanged: Number(row.unchanged || 0),
    declines: Number(row.declines || 0),
    ceilings: Number(row.ceilings || 0),
    floors: Number(row.floors || 0),
    marketPe: row.market_pe != null ? Number(row.market_pe) : null,
    foreignBuyValue: row.foreign_buy_value != null ? Number(row.foreign_buy_value) : null,
    foreignSellValue: row.foreign_sell_value != null ? Number(row.foreign_sell_value) : null,
    foreignNetValue: row.foreign_net_value != null ? Number(row.foreign_net_value) : null,
    qualityStatus: (row.quality_status as QualityStatus) || "healthy",
    evidenceRefs: Array.isArray(row.evidence_refs) ? (row.evidence_refs as EvidenceRef[]) : [],
    asOf: String(row.as_of || new Date().toISOString()),
  }))

  // Ensure index order: VNINDEX, VN30, HNX, UPCOM
  const orderMap = { VNINDEX: 1, VN30: 2, HNX: 3, UPCOM: 4 }
  indexes.sort((a, b) => (orderMap[a.indexCode] || 99) - (orderMap[b.indexCode] || 99))

  const sectors: MarketSectorRow[] = (sectorsRes.data || []).map((row: Record<string, unknown>) => ({
    sectorKey: String(row.sector_key || ""),
    timeWindow: (row.time_window as MarketSectorRow["timeWindow"]) || "1d",
    displayName: String(row.display_name || row.sector_key || ""),
    tradedValue: row.traded_value != null ? Number(row.traded_value) : null,
    averageChangePct: row.average_change_pct != null ? Number(row.average_change_pct) : null,
    advances: Number(row.advances || 0),
    unchanged: Number(row.unchanged || 0),
    declines: Number(row.declines || 0),
    rsScore: row.rs_score != null ? Number(row.rs_score) : null,
    rotationState: (row.rotation_state as RotationState) || "unknown",
    strengthRatio: row.strength_ratio != null ? Number(row.strength_ratio) : null,
    momentumRatio: row.momentum_ratio != null ? Number(row.momentum_ratio) : null,
    effortPct: row.effort_pct != null ? Number(row.effort_pct) : null,
    resultPct: row.result_pct != null ? Number(row.result_pct) : null,
    effortResultState: (row.effort_result_state as string) || null,
    qualityStatus: (row.quality_status as QualityStatus) || "healthy",
    evidenceRefs: Array.isArray(row.evidence_refs) ? (row.evidence_refs as EvidenceRef[]) : [],
    asOf: String(row.as_of || new Date().toISOString()),
  }))

  const leaders: MarketLeaderItem[] = (leadersRes.data || []).map((row: Record<string, unknown>) => ({
    category: row.category as LeaderCategory,
    rank: Number(row.rank || 1),
    ticker: String(row.ticker || "").toUpperCase(),
    price: row.price != null ? Number(row.price) : null,
    changePct: row.change_pct != null ? Number(row.change_pct) : null,
    estimatedIndexPoints: row.estimated_index_points != null ? Number(row.estimated_index_points) : null,
    metricValue: row.metric_value != null ? Number(row.metric_value) : null,
    metricLabel: (row.metric_label as string) || null,
    qualityStatus: (row.quality_status as QualityStatus) || "healthy",
    evidenceRefs: Array.isArray(row.evidence_refs) ? (row.evidence_refs as EvidenceRef[]) : [],
    asOf: String(row.as_of || new Date().toISOString()),
  }))

  const history: MarketHistoryPoint[] = (historyRes.data || [])
    .map((row: Record<string, unknown>) => ({
      sessionDate: String(row.session_date),
      sentimentScore: row.sentiment_score != null ? Number(row.sentiment_score) : null,
      riskScore: row.risk_score != null ? Number(row.risk_score) : null,
      aboveMa10Pct: row.above_ma10_pct != null ? Number(row.above_ma10_pct) : null,
      aboveMa20Pct: row.above_ma20_pct != null ? Number(row.above_ma20_pct) : null,
      aboveMa50Pct: row.above_ma50_pct != null ? Number(row.above_ma50_pct) : null,
      aboveMa200Pct: row.above_ma200_pct != null ? Number(row.above_ma200_pct) : null,
      foreignNetValue: row.foreign_net_value != null ? Number(row.foreign_net_value) : null,
      proprietaryNetValue: row.proprietary_net_value != null ? Number(row.proprietary_net_value) : null,
      totalTradedValue: row.total_traded_value != null ? Number(row.total_traded_value) : null,
      vnindexClose: null,
      vnindexChangePct: null,
    }))
    .reverse()

  // Generate deterministic observations
  const modelInput: MarketObservationSnapshotInput = {
    sessionDate: targetDate,
    asOf: daily.as_of || new Date().toISOString(),
    regime: (daily.market_regime as MarketRegime) || "PHÂN HÓA",
    daily: {
      sentimentScore: daily.sentiment_score != null ? Number(daily.sentiment_score) : null,
      sentimentLabel: daily.sentiment_label || null,
      riskScore: daily.risk_score != null ? Number(daily.risk_score) : null,
      riskLabel: daily.risk_label || null,
      distributionCount: daily.distribution_count != null ? Number(daily.distribution_count) : null,
      aboveMa10Pct: daily.above_ma10_pct != null ? Number(daily.above_ma10_pct) : null,
      aboveMa20Pct: daily.above_ma20_pct != null ? Number(daily.above_ma20_pct) : null,
      aboveMa50Pct: daily.above_ma50_pct != null ? Number(daily.above_ma50_pct) : null,
      aboveMa200Pct: daily.above_ma200_pct != null ? Number(daily.above_ma200_pct) : null,
      foreignNetValue: daily.foreign_net_value != null ? Number(daily.foreign_net_value) : null,
      proprietaryNetValue: daily.proprietary_net_value != null ? Number(daily.proprietary_net_value) : null,
      totalMatchedVolume: daily.total_matched_volume != null ? Number(daily.total_matched_volume) : null,
      totalTradedValue: daily.total_traded_value != null ? Number(daily.total_traded_value) : null,
      qualityStatus: daily.quality_status || "healthy",
    },
    indexes: indexes.map((i) => ({
      indexCode: i.indexCode,
      value: i.value,
      change: i.change,
      changePct: i.changePct,
      tradedValue: i.tradedValue,
      advances: i.advances,
      unchanged: i.unchanged,
      declines: i.declines,
      ceilings: i.ceilings,
      floors: i.floors,
    })),
    sectors: sectors.map((s) => ({
      sectorKey: s.sectorKey,
      displayName: s.displayName,
      timeWindow: s.timeWindow,
      tradedValue: s.tradedValue,
      averageChangePct: s.averageChangePct,
      rsScore: s.rsScore,
      rotationState: s.rotationState,
      advances: s.advances,
      declines: s.declines,
    })),
    leaders: leaders.map((l) => ({
      category: l.category,
      rank: l.rank,
      ticker: l.ticker,
      price: l.price,
      changePct: l.changePct,
      estimatedIndexPoints: l.estimatedIndexPoints,
      metricValue: l.metricValue,
      metricLabel: l.metricLabel,
    })),
  }

  const observations = generateMarketObservations(modelInput)

  return {
    sessionDate: targetDate,
    isStale,
    staleMessage: isStale ? `Dữ liệu phiên ${targetDate} (chưa có snapshot phiên hôm nay)` : undefined,
    asOf: daily.as_of || new Date().toISOString(),
    qualityStatus: daily.quality_status || "healthy",
    marketRegime: (daily.market_regime as MarketRegime) || "PHÂN HÓA",
    dailySummary: {
      sentimentScore: daily.sentiment_score != null ? Number(daily.sentiment_score) : null,
      sentimentLabel: daily.sentiment_label || null,
      riskScore: daily.risk_score != null ? Number(daily.risk_score) : null,
      riskLabel: daily.risk_label || null,
      distributionCount: daily.distribution_count != null ? Number(daily.distribution_count) : null,
      distributionWindow: daily.distribution_window || "25_sessions",
      aboveMa10Pct: daily.above_ma10_pct != null ? Number(daily.above_ma10_pct) : null,
      aboveMa20Pct: daily.above_ma20_pct != null ? Number(daily.above_ma20_pct) : null,
      aboveMa50Pct: daily.above_ma50_pct != null ? Number(daily.above_ma50_pct) : null,
      aboveMa200Pct: daily.above_ma200_pct != null ? Number(daily.above_ma200_pct) : null,
      foreignNetValue: daily.foreign_net_value != null ? Number(daily.foreign_net_value) : null,
      proprietaryNetValue: daily.proprietary_net_value != null ? Number(daily.proprietary_net_value) : null,
      otherFlowNetValue: daily.other_flow_net_value != null ? Number(daily.other_flow_net_value) : null,
      totalMatchedVolume: daily.total_matched_volume != null ? Number(daily.total_matched_volume) : null,
      totalTradedValue: daily.total_traded_value != null ? Number(daily.total_traded_value) : null,
      qualityStatus: daily.quality_status || "healthy",
      missingFields: Array.isArray(daily.missing_fields) ? daily.missing_fields : [],
      evidenceRefs: Array.isArray(daily.evidence_refs) ? daily.evidence_refs : [],
      sourceTimestamp: daily.source_timestamp || null,
    },
    indexes,
    sectors,
    leaders,
    observations,
    history,
  }
}
