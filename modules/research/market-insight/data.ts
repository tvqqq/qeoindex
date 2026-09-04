import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  generateMarketObservations,
  type MarketObservation,
  type MarketObservationSnapshotInput,
} from "@/modules/research/market-insight/model"
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
  closePrice: number | null
  tradedValue: number | null
  previousTradedValue: number | null
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
  ma10State: "up" | "down" | null
  ma20State: "up" | "down" | null
  ma50State: "up" | "down" | null
  rotationHistory: Array<{ tradingDate: string; status: RotationState; closePrice: number | null }>
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

export interface MarketSectorHistoryItem {
  sessionDate: string
  sectorKey: string
  displayName: string
  rotationState: RotationState
  averageChangePct: number | null
  rsScore: number | null
  effortPct: number | null
  resultPct: number | null
  tradedValue: number | null
  closePrice: number | null
}

export interface MarketCloseDashboardData {
  sessionDate: string
  isStale: boolean
  staleMessage?: string
  asOf: string
  qualityStatus: QualityStatus
  marketRegime: MarketRegime | null
  dailySummary: {
    sentimentScore: number | null
    sentimentLabel: string | null
    riskScore: number | null
    riskLabel: string | null
    distributionCount: number | null
    distributionWindow: string | null
    sentimentHistory: Array<{ tradingDate: string; value: number }>
    riskHistory: Array<{ tradingDate: string; risk: number }>
    valuationHistory: Array<{
      tradingDate: string
      price: number | null
      pe: number | null
      pb: number | null
      pe1StdUp: number | null
      pe1StdDown: number | null
      pe2StdUp: number | null
      pe2StdDown: number | null
      pb1StdUp: number | null
      pb1StdDown: number | null
      pb2StdUp: number | null
      pb2StdDown: number | null
    }>
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
  sectorHistory?: MarketSectorHistoryItem[]
  leaders: MarketLeaderItem[]
  observations: MarketObservation[]
  history: MarketHistoryPoint[]
  /** Provenance shared by the AI packet builder and the Edge runtime. */
  marketInsightProvenance: {
    syncRunId: string
    payloadChecksum: string
    contractVersion: number
    endpointCoverage: Record<string, boolean>
    publishedCounts: Record<string, number>
  } | null
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
  const [dailyRes, indexesRes, sectorsRes, leadersRes, historyRes, vnindexHistoryRes, sectorHistoryRes] = await Promise.all([
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
    supabase
      .from("market_insight_indexes")
      .select("session_date,value,change_pct")
      .eq("index_code", "VNINDEX")
      .lte("session_date", targetDate)
      .order("session_date", { ascending: false })
      .limit(20),
    supabase
      .from("market_insight_sectors")
      .select("session_date,sector_key,display_name,rotation_state,average_change_pct,rs_score,effort_pct,result_pct,traded_value,close_price")
      .eq("time_window", "1d")
      .lte("session_date", targetDate)
      .order("session_date", { ascending: false })
      .limit(300),
  ])

  const daily = dailyRes.data
  if (!daily) {
    return null
  }

  const syncRunId = typeof daily.sync_run_id === "string" ? daily.sync_run_id : ""
  const syncRunRes = syncRunId
    ? await supabase
      .from("market_insight_sync_runs")
      .select("id,session_date,status,contract_version,payload_checksum,endpoint_coverage,published_counts")
      .eq("id", syncRunId)
      .maybeSingle()
    : { data: null, error: null }
  const syncRun = syncRunRes.data as Record<string, unknown> | null
  const publishedCounts = syncRun && syncRun.published_counts && typeof syncRun.published_counts === "object" && !Array.isArray(syncRun.published_counts)
    ? Object.fromEntries(Object.entries(syncRun.published_counts as Record<string, unknown>).flatMap(([key, value]) => {
      const numeric = Number(value)
      return Number.isFinite(numeric) ? [[key, numeric]] : []
    }))
    : null
  const endpointCoverage = syncRun && syncRun.endpoint_coverage && typeof syncRun.endpoint_coverage === "object" && !Array.isArray(syncRun.endpoint_coverage)
    ? Object.fromEntries(Object.entries(syncRun.endpoint_coverage as Record<string, unknown>).flatMap(([key, value]) => typeof value === "boolean" ? [[key, value]] : []))
    : null
  const provenanceAvailable = Boolean(
    !syncRunRes.error && syncRun && syncRun.status === "completed" && String(syncRun.session_date) === targetDate &&
    typeof syncRun.payload_checksum === "string" && /^[0-9a-f]{64}$/.test(syncRun.payload_checksum) &&
    Number.isInteger(Number(syncRun.contract_version)) && Number(syncRun.contract_version) > 0 &&
    publishedCounts && endpointCoverage &&
    Number(publishedCounts.daily) === 1 && Number(publishedCounts.index) === (indexesRes.data || []).length &&
    Number(publishedCounts.sector) === (sectorsRes.data || []).filter((row) => row.time_window === "1d").length &&
    Number(publishedCounts.leader) === (leadersRes.data || []).length &&
    Object.values(endpointCoverage).length > 0 && Object.values(endpointCoverage).every(Boolean) &&
    Object.entries(endpointCoverage).every(([key, value]) => !key || typeof value === "boolean") &&
    (indexesRes.data || []).every((row) => row.sync_run_id === syncRunId) &&
    (sectorsRes.data || []).every((row) => row.sync_run_id === syncRunId) &&
    (leadersRes.data || []).every((row) => row.sync_run_id === syncRunId)
  )

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
    closePrice: row.close_price != null ? Number(row.close_price) : null,
    tradedValue: row.traded_value != null ? Number(row.traded_value) : null,
    previousTradedValue: row.previous_traded_value != null ? Number(row.previous_traded_value) : null,
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
    ma10State: row.ma10_state === "up" || row.ma10_state === "down" ? row.ma10_state : null,
    ma20State: row.ma20_state === "up" || row.ma20_state === "down" ? row.ma20_state : null,
    ma50State: row.ma50_state === "up" || row.ma50_state === "down" ? row.ma50_state : null,
    rotationHistory: Array.isArray(row.rotation_history)
      ? row.rotation_history.flatMap((item: unknown) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return []
          const value = item as Record<string, unknown>
          const status = value.status as RotationState
          if (!value.trading_date || !["leading", "recovering", "weakening", "lagging"].includes(status)) return []
          return [{
            tradingDate: String(value.trading_date),
            status,
            closePrice: value.close_price != null ? Number(value.close_price) : null,
          }]
        })
      : [],
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

  const vnindexHistoryByDate = new Map(
    (vnindexHistoryRes.data || []).map((row: Record<string, unknown>) => [
      String(row.session_date),
      {
        close: row.value != null ? Number(row.value) : null,
        changePct: row.change_pct != null ? Number(row.change_pct) : null,
      },
    ])
  )

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
      vnindexClose: vnindexHistoryByDate.get(String(row.session_date))?.close ?? null,
      vnindexChangePct: vnindexHistoryByDate.get(String(row.session_date))?.changePct ?? null,
    }))
    .reverse()

  // Generate deterministic observations
  const modelInput: MarketObservationSnapshotInput = {
    sessionDate: targetDate,
    asOf: daily.as_of || new Date().toISOString(),
    regime: (daily.market_regime as MarketRegime) || null,
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

  const storedSectorHistory: MarketSectorHistoryItem[] = (sectorHistoryRes.data || []).map((row: Record<string, unknown>) => ({
    sessionDate: String(row.session_date || ""),
    sectorKey: String(row.sector_key || ""),
    displayName: String(row.display_name || row.sector_key || ""),
    rotationState: (row.rotation_state as RotationState) || "unknown",
    averageChangePct: row.average_change_pct != null ? Number(row.average_change_pct) : null,
    rsScore: row.rs_score != null ? Number(row.rs_score) : null,
    effortPct: row.effort_pct != null ? Number(row.effort_pct) : null,
    resultPct: row.result_pct != null ? Number(row.result_pct) : null,
    tradedValue: row.traded_value != null ? Number(row.traded_value) : null,
    closePrice: row.close_price != null ? Number(row.close_price) : null,
  }))
  const providerSectorHistory: MarketSectorHistoryItem[] = sectors.flatMap((sector) =>
    sector.rotationHistory.map((point) => ({
      sessionDate: point.tradingDate,
      sectorKey: sector.sectorKey,
      displayName: sector.displayName,
      rotationState: point.status,
      averageChangePct: null,
      rsScore: null,
      effortPct: null,
      resultPct: null,
      tradedValue: null,
      closePrice: point.closePrice,
    })))
  const sectorHistory = [...new Map(
    [...storedSectorHistory, ...providerSectorHistory]
      .map((item) => [`${item.sectorKey}:${item.sessionDate}`, item]),
  ).values()]

  const parseDailySeries = <T,>(value: unknown, parser: (row: Record<string, unknown>) => T | null): T[] =>
    Array.isArray(value) ? value.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return []
      const parsed = parser(item as Record<string, unknown>)
      return parsed == null ? [] : [parsed]
    }) : []

  return {
    sessionDate: targetDate,
    isStale,
    staleMessage: isStale ? `Dữ liệu phiên ${targetDate} (chưa có snapshot phiên hôm nay)` : undefined,
    asOf: daily.as_of || new Date().toISOString(),
    qualityStatus: daily.quality_status || "healthy",
    marketRegime: (daily.market_regime as MarketRegime) || null,
    dailySummary: {
      sentimentScore: daily.sentiment_score != null ? Number(daily.sentiment_score) : null,
      sentimentLabel: daily.sentiment_label || null,
      riskScore: daily.risk_score != null ? Number(daily.risk_score) : null,
      riskLabel: daily.risk_label || null,
      distributionCount: daily.distribution_count != null ? Number(daily.distribution_count) : null,
      distributionWindow: daily.distribution_window || null,
      sentimentHistory: parseDailySeries(daily.sentiment_history, (row) =>
        row.trading_date && row.value != null
          ? { tradingDate: String(row.trading_date), value: Number(row.value) }
          : null),
      riskHistory: parseDailySeries(daily.risk_history, (row) =>
        row.trading_date && row.risk != null
          ? { tradingDate: String(row.trading_date), risk: Number(row.risk) }
          : null),
      valuationHistory: parseDailySeries(daily.valuation_history, (row) => row.trading_date ? ({
        tradingDate: String(row.trading_date),
        price: row.price != null ? Number(row.price) : null,
        pe: row.pe != null ? Number(row.pe) : null,
        pb: row.pb != null ? Number(row.pb) : null,
        pe1StdUp: row.pe_1std_up != null ? Number(row.pe_1std_up) : null,
        pe1StdDown: row.pe_1std_down != null ? Number(row.pe_1std_down) : null,
        pe2StdUp: row.pe_2std_up != null ? Number(row.pe_2std_up) : null,
        pe2StdDown: row.pe_2std_down != null ? Number(row.pe_2std_down) : null,
        pb1StdUp: row.pb_1std_up != null ? Number(row.pb_1std_up) : null,
        pb1StdDown: row.pb_1std_down != null ? Number(row.pb_1std_down) : null,
        pb2StdUp: row.pb_2std_up != null ? Number(row.pb_2std_up) : null,
        pb2StdDown: row.pb_2std_down != null ? Number(row.pb_2std_down) : null,
      }) : null),
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
    sectorHistory,
    leaders,
    observations,
    history,
    marketInsightProvenance: provenanceAvailable ? {
      syncRunId,
      payloadChecksum: String(syncRun?.payload_checksum),
      contractVersion: Number(syncRun?.contract_version),
      endpointCoverage: endpointCoverage as Record<string, boolean>,
      publishedCounts: publishedCounts as Record<string, number>,
    } : null,
  }
}
