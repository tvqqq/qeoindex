export type MarketRegime = "TÍCH CỰC" | "PHÂN HÓA" | "THẬN TRỌNG" | "RỦI RO"
export type RotationState = "leading" | "recovering" | "weakening" | "lagging" | "unknown"
export type QualityStatus = "healthy" | "degraded" | "failing" | "stale"
export type LeaderCategory =
  | "index_up"
  | "index_down"
  | "top_volume"
  | "near_52w_high"
  | "accumulation"
  | "cross_ma10"
  | "foreign_buy"
  | "foreign_sell"

export interface EvidenceRef {
  field: string
  source_class: "market_pulse" | "market_indexes" | "market_sectors" | "market_flows" | "market_leaders" | "canonical_market_feed"
  observed_at: string
  unit?: string
}

export interface StagedItem<T> {
  staging_key: string
  category: "daily" | "index" | "sector" | "leader"
  payload: T
}

export interface NormalizedDailySummary {
  session_date: string
  market_regime: MarketRegime
  sentiment_score: number | null
  sentiment_label: string | null
  risk_score: number | null
  risk_label: string | null
  distribution_count: number | null
  distribution_window: string
  above_ma10_pct: number | null
  above_ma20_pct: number | null
  above_ma50_pct: number | null
  above_ma200_pct: number | null
  foreign_net_value: number | null
  proprietary_net_value: number | null
  other_flow_net_value: number | null
  total_matched_volume: number | null
  total_traded_value: number | null
  quality_status: QualityStatus
  missing_fields: string[]
  evidence_refs: EvidenceRef[]
  source_timestamp: string | null
  as_of: string
}

export interface NormalizedIndexRow {
  session_date: string
  index_code: "VNINDEX" | "VN30" | "HNX" | "UPCOM"
  value: number | null
  change: number | null
  change_pct: number | null
  reference: number | null
  open: number | null
  high: number | null
  low: number | null
  matched_volume: number | null
  traded_value: number | null
  previous_value_change_pct: number | null
  advances: number
  unchanged: number
  declines: number
  ceilings: number
  floors: number
  market_pe: number | null
  foreign_buy_value: number | null
  foreign_sell_value: number | null
  foreign_net_value: number | null
  quality_status: QualityStatus
  missing_fields: string[]
  evidence_refs: EvidenceRef[]
  source_timestamp: string | null
  as_of: string
}

export interface NormalizedSectorRow {
  session_date: string
  sector_key: string
  time_window: "1d" | "5d" | "20d"
  display_name: string
  traded_value: number | null
  average_change_pct: number | null
  advances: number
  unchanged: number
  declines: number
  rs_score: number | null
  rotation_state: RotationState
  strength_ratio: number | null
  momentum_ratio: number | null
  effort_pct: number | null
  result_pct: number | null
  effort_result_state: string | null
  quality_status: QualityStatus
  missing_fields: string[]
  evidence_refs: EvidenceRef[]
  source_timestamp: string | null
  as_of: string
}

export interface NormalizedLeaderRow {
  session_date: string
  category: LeaderCategory
  rank: number
  ticker: string
  price: number | null
  change_pct: number | null
  estimated_index_points: number | null
  metric_value: number | null
  metric_label: string | null
  quality_status: QualityStatus
  missing_fields: string[]
  evidence_refs: EvidenceRef[]
  source_timestamp: string | null
  as_of: string
}

export interface NormalizedMarketSnapshot {
  session_date: string
  contract_version: number
  daily: NormalizedDailySummary
  indexes: NormalizedIndexRow[]
  sectors: NormalizedSectorRow[]
  leaders: NormalizedLeaderRow[]
  staged_items: StagedItem<Record<string, unknown>>[]
  quality_status: QualityStatus
  endpoint_coverage: Record<string, boolean>
  staged_counts: {
    daily: number
    index: number
    sector: number
    leader: number
    total: number
  }
}

export function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "--" || trimmed === "-" || trimmed === "N/A" || trimmed === "null") return null
  const clean = trimmed.replace(/,/g, "").replace(/%/g, "").replace(/\+/g, "")
  const parsed = Number(clean)
  return Number.isFinite(parsed) ? parsed : null
}

export function clampPercent(value: number | null): number | null {
  if (value == null) return null
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}

export function mapRotationState(state: unknown): RotationState {
  if (typeof state !== "string") return "unknown"
  const normalized = state.trim().toLowerCase()
  if (normalized.includes("lead") || normalized.includes("dẫn dắt") || normalized.includes("leading")) return "leading"
  if (normalized.includes("recov") || normalized.includes("phục hồi") || normalized.includes("improving")) return "recovering"
  if (normalized.includes("weak") || normalized.includes("suy yếu") || normalized.includes("weakening")) return "weakening"
  if (normalized.includes("lag") || normalized.includes("tụt hậu") || normalized.includes("lagging")) return "lagging"
  return "unknown"
}

export function normalizeSectorSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function deriveMarketRegime(params: {
  vnindexChangePct: number | null
  breadthAdvances: number
  breadthDeclines: number
  sentimentScore: number | null
  riskScore: number | null
  distributionCount: number | null
}): MarketRegime {
  const { vnindexChangePct, breadthAdvances, breadthDeclines, riskScore, distributionCount } = params
  const advanceRatio = breadthAdvances + breadthDeclines > 0 ? breadthAdvances / (breadthAdvances + breadthDeclines) : 0.5

  if ((riskScore != null && riskScore >= 75) || (distributionCount != null && distributionCount >= 5)) {
    return "RỦI RO"
  }

  if (vnindexChangePct != null && vnindexChangePct > 0.5 && advanceRatio >= 0.6) {
    return "TÍCH CỰC"
  }

  if (vnindexChangePct != null && vnindexChangePct < -0.5 && advanceRatio <= 0.4) {
    return "THẬN TRỌNG"
  }

  if (Math.abs(advanceRatio - 0.5) < 0.15 || (vnindexChangePct != null && Math.abs(vnindexChangePct) <= 0.5)) {
    return "PHÂN HÓA"
  }

  return advanceRatio >= 0.5 ? "TÍCH CỰC" : "THẬN TRỌNG"
}

export function deriveRiskLabel(riskScore: number | null): string | null {
  if (riskScore == null) return null
  if (riskScore < 40) return "Thấp"
  if (riskScore <= 70) return "Trung tính"
  if (riskScore <= 85) return "Cao"
  return "Rất cao"
}

export function deriveSentimentLabel(sentimentScore: number | null): string | null {
  if (sentimentScore == null) return null
  if (sentimentScore >= 70) return "Hưng phấn"
  if (sentimentScore >= 50) return "Lạc quan"
  if (sentimentScore >= 35) return "Thận trọng"
  return "Bi quan"
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseJsonSafe(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null
  try {
    const parsed = JSON.parse(value)
    return asObject(parsed)
  } catch {
    return null
  }
}

export function parseVerifiedMarketClosePayloads(params: {
  sessionDate: string
  asOfIso: string
  pulseContentPayload?: unknown
  pulseOk?: boolean
  maBreadthPayload?: unknown
  maBreadthOk?: boolean
  riskPayload?: unknown
  riskOk?: boolean
  psychologyPayload?: unknown
  psychologyOk?: boolean
  sectorPulsePayload?: unknown
  sectorPulseOk?: boolean
  sectorBreadthPayload?: unknown
  sectorBreadthOk?: boolean
  cashFlowsPayload?: unknown
  cashFlowsOk?: boolean
  topVolatilityTickers?: unknown
  getLivePayload?: unknown
  getLiveOk?: boolean
  canonicalIndexes: NormalizedIndexRow[]
}): NormalizedMarketSnapshot {
  const {
    sessionDate,
    asOfIso,
    pulseContentPayload,
    pulseOk = false,
    maBreadthPayload,
    maBreadthOk = false,
    riskPayload,
    riskOk = false,
    psychologyPayload,
    psychologyOk = false,
    sectorPulsePayload,
    sectorPulseOk = false,
    sectorBreadthPayload,
    sectorBreadthOk = false,
    cashFlowsPayload,
    cashFlowsOk = false,
    topVolatilityTickers,
    getLivePayload,
    getLiveOk = false,
    canonicalIndexes,
  } = params

  const coverage: Record<string, boolean> = {
    market_pulse_content: false,
    ma_breadth: false,
    risk_indicator: false,
    psychology_indicator: false,
    sector_pulse: false,
    sector_breadth: false,
    cash_flows: false,
    get_live: false,
    canonical_indexes: canonicalIndexes.length === 4 && canonicalIndexes.every((i) => i.value != null && i.value > 0),
  }

  const dailyMissing: string[] = []
  const dailyEvidence: EvidenceRef[] = []

  // 1. Parse Pulse Content (JSON string inside content field)
  const pulseRoot = asObject(pulseContentPayload)
  let distributionCount: number | null = null

  if (pulseOk && pulseRoot && typeof pulseRoot.content === "string") {
    const parsedContent = parseJsonSafe(pulseRoot.content)
    const listMain = Array.isArray(parsedContent?.list_main_content) ? parsedContent.list_main_content : []
    if (listMain.length > 0) {
      for (const item of listMain) {
        const obj = asObject(item)
        if (!obj || typeof obj.title !== "string") continue
        if (obj.title === "Ngày phân phối" && obj.distribution_date != null) {
          distributionCount = parseNumeric(obj.distribution_date)
        }
      }
    }
  }

  if (distributionCount != null) {
    coverage.market_pulse_content = true
    dailyEvidence.push({ field: "distribution_count", source_class: "market_pulse", observed_at: asOfIso, unit: "sessions" })
  } else {
    dailyMissing.push("distribution_count")
  }

  // 2. Parse MA Breadth { name[], above[], under[] }
  let ma10: number | null = null
  let ma20: number | null = null
  let ma50: number | null = null
  let ma200: number | null = null

  const maObj = asObject(maBreadthPayload)
  if (maBreadthOk && maObj && Array.isArray(maObj.name) && Array.isArray(maObj.above) && Array.isArray(maObj.under)) {
    const names = maObj.name as unknown[]
    const aboveArr = maObj.above as unknown[]
    const underArr = maObj.under as unknown[]

    names.forEach((nameRaw, idx) => {
      const name = String(nameRaw || "").trim().toUpperCase()
      const above = parseNumeric(aboveArr[idx]) ?? 0
      const under = parseNumeric(underArr[idx]) ?? 0
      const total = above + under
      const pct = total > 0 ? clampPercent((above / total) * 100) : null

      if (name === "MA200" || name.endsWith("200") || name.includes("MA200")) ma200 = pct
      else if (name === "MA50" || name.endsWith("50") || name.includes("MA50")) ma50 = pct
      else if (name === "MA20" || name.endsWith("20") || name.includes("MA20")) ma20 = pct
      else if (name === "MA10" || name.endsWith("10") || name.includes("MA10")) ma10 = pct
    })

    coverage.ma_breadth = ma10 != null && ma20 != null && ma50 != null && ma200 != null
  }

  if (ma20 != null) dailyEvidence.push({ field: "above_ma20_pct", source_class: "market_pulse", observed_at: asOfIso, unit: "%" })
  else dailyMissing.push("above_ma20_pct")

  // 3. Parse Risk Indicator [ { risk: number } ]
  let riskScore: number | null = null
  if (riskOk && Array.isArray(riskPayload) && riskPayload.length > 0) {
    const first = asObject(riskPayload[0])
    const rawRisk = parseNumeric(first?.risk)
    if (rawRisk != null) {
      coverage.risk_indicator = true
      riskScore = rawRisk <= 1.0 ? clampPercent(rawRisk * 100) : clampPercent(rawRisk)
      dailyEvidence.push({ field: "risk_score", source_class: "market_pulse", observed_at: asOfIso, unit: "score_0_100" })
    }
  }
  if (riskScore == null) dailyMissing.push("risk_score")

  // 4. Parse Psychology / Sentiment [ { value: number } ]
  let sentimentScore: number | null = null
  if (psychologyOk && Array.isArray(psychologyPayload) && psychologyPayload.length > 0) {
    const first = asObject(psychologyPayload[0])
    const rawVal = parseNumeric(first?.value)
    if (rawVal != null) {
      coverage.psychology_indicator = true
      sentimentScore = clampPercent(rawVal)
      dailyEvidence.push({ field: "sentiment_score", source_class: "market_pulse", observed_at: asOfIso, unit: "score_0_100" })
    }
  }
  if (sentimentScore == null) dailyMissing.push("sentiment_score")

  // 5. Parse Cash Flows { tradingdate[], nuocngoairong[], tudoanh[], cntckhacrong[] }
  let foreignNet: number | null = null
  let proprietaryNet: number | null = null
  let otherFlowNet: number | null = null

  const cashObj = asObject(cashFlowsPayload)
  if (cashFlowsOk && cashObj && Array.isArray(cashObj.nuocngoairong)) {
    const nuocNgoai = cashObj.nuocngoairong as unknown[]
    const tuDoanh = Array.isArray(cashObj.tudoanh) ? (cashObj.tudoanh as unknown[]) : []
    const khac = Array.isArray(cashObj.cntckhacrong) ? (cashObj.cntckhacrong as unknown[]) : []

    const lastIdx = nuocNgoai.length - 1
    if (lastIdx >= 0) {
      foreignNet = parseNumeric(nuocNgoai[lastIdx])
      proprietaryNet = parseNumeric(tuDoanh[lastIdx])
      otherFlowNet = parseNumeric(khac[lastIdx])
      if (foreignNet != null && proprietaryNet != null) {
        coverage.cash_flows = true
      }
    }
  }

  if (foreignNet != null) dailyEvidence.push({ field: "foreign_net_value", source_class: "market_flows", observed_at: asOfIso, unit: "billion_vnd" })
  else dailyMissing.push("foreign_net_value")

  if (proprietaryNet != null) dailyEvidence.push({ field: "proprietary_net_value", source_class: "market_flows", observed_at: asOfIso, unit: "billion_vnd" })
  else dailyMissing.push("proprietary_net_value")

  // 6. Canonical Indexes OHLC / Breadth
  const vnindex = canonicalIndexes.find((i) => i.index_code === "VNINDEX")
  const totalVolume = vnindex?.matched_volume ?? null
  const totalValue = vnindex?.traded_value ?? null

  const sentimentLabel = deriveSentimentLabel(sentimentScore)
  const riskLabel = deriveRiskLabel(riskScore)

  const marketRegime = deriveMarketRegime({
    vnindexChangePct: vnindex?.change_pct ?? null,
    breadthAdvances: vnindex?.advances ?? 0,
    breadthDeclines: vnindex?.declines ?? 0,
    sentimentScore,
    riskScore,
    distributionCount: distributionCount != null ? Math.round(distributionCount) : null,
  })

  const dailyQuality: QualityStatus = dailyMissing.length > 2 ? "degraded" : "healthy"

  const daily: NormalizedDailySummary = {
    session_date: sessionDate,
    market_regime: marketRegime,
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    risk_score: riskScore,
    risk_label: riskLabel,
    distribution_count: distributionCount != null ? Math.max(0, Math.round(distributionCount)) : null,
    distribution_window: "25_sessions",
    above_ma10_pct: ma10,
    above_ma20_pct: ma20,
    above_ma50_pct: ma50,
    above_ma200_pct: ma200,
    foreign_net_value: foreignNet,
    proprietary_net_value: proprietaryNet,
    other_flow_net_value: otherFlowNet,
    total_matched_volume: totalVolume,
    total_traded_value: totalValue,
    quality_status: dailyQuality,
    missing_fields: dailyMissing,
    evidence_refs: dailyEvidence,
    source_timestamp: asOfIso,
    as_of: asOfIso,
  }

  // 7. Parse Sectors
  const sectorMap = new Map<string, NormalizedSectorRow>()
  const secObj = asObject(sectorPulsePayload)
  if (sectorPulseOk && secObj && Array.isArray(secObj.name) && Array.isArray(secObj.percent)) {
    const names = secObj.name as unknown[]
    const percents = secObj.percent as unknown[]
    const totalVals = Array.isArray(secObj.totalval) ? (secObj.totalval as unknown[]) : []

    names.forEach((nameRaw, idx) => {
      const displayName = String(nameRaw || "").trim()
      const slug = normalizeSectorSlug(displayName)
      const avgChange = parseNumeric(percents[idx])
      if (!slug || avgChange == null) return

      const tradedVal = parseNumeric(totalVals[idx])

      sectorMap.set(slug, {
        session_date: sessionDate,
        sector_key: slug,
        time_window: "1d",
        display_name: displayName,
        traded_value: tradedVal,
        average_change_pct: avgChange,
        advances: 0,
        unchanged: 0,
        declines: 0,
        rs_score: null,
        rotation_state: "unknown",
        strength_ratio: null,
        momentum_ratio: null,
        effort_pct: null,
        result_pct: avgChange,
        effort_result_state: null,
        quality_status: "healthy",
        missing_fields: [],
        evidence_refs: [
          { field: "average_change_pct", source_class: "market_sectors", observed_at: asOfIso, unit: "%" },
        ],
        source_timestamp: asOfIso,
        as_of: asOfIso,
      })
    })

    if (sectorMap.size > 0) coverage.sector_pulse = true
  }

  // Merge sector breadth if available: requires EVERY sector row to match with 3 non-negative counts
  let validSectorBreadthCount = 0
  if (sectorBreadthOk && Array.isArray(sectorBreadthPayload)) {
    const breadthBySlug = new Map<string, { adv: number; dec: number; unc: number }>()
    for (const item of sectorBreadthPayload) {
      const obj = asObject(item)
      if (!obj || typeof obj.nganh !== "string") continue
      const slug = normalizeSectorSlug(obj.nganh)
      const adv = parseNumeric(obj.count_advances)
      const dec = parseNumeric(obj.count_declines)
      const unc = parseNumeric(obj.count_nochange)
      if (slug && adv != null && adv >= 0 && dec != null && dec >= 0 && unc != null && unc >= 0) {
        breadthBySlug.set(slug, { adv: Math.round(adv), dec: Math.round(dec), unc: Math.round(unc) })
      }
    }

    for (const [slug, sec] of sectorMap.entries()) {
      const b = breadthBySlug.get(slug)
      if (b) {
        sec.advances = b.adv
        sec.declines = b.dec
        sec.unchanged = b.unc
        validSectorBreadthCount += 1
      }
    }

    if (sectorMap.size > 0 && validSectorBreadthCount === sectorMap.size) {
      coverage.sector_breadth = true
    }
  }

  const sectors = Array.from(sectorMap.values())

  // 8. Parse Leaders: only include tickers that actually match live response with price or volume
  const leaders: NormalizedLeaderRow[] = []
  const liveObj = asObject(getLivePayload)
  const tickers = Array.isArray(topVolatilityTickers)
    ? (topVolatilityTickers as unknown[]).map((t) => String(t || "").trim().toUpperCase()).filter((t) => /^[A-Z0-9]{2,12}$/.test(t))
    : []

  if (getLiveOk && liveObj && Array.isArray(liveObj.stockcode) && Array.isArray(liveObj.lastprice)) {
    const liveCodes = liveObj.stockcode as unknown[]
    const livePrices = liveObj.lastprice as unknown[]
    const liveChanges = Array.isArray(liveObj.change) ? (liveObj.change as unknown[]) : []
    const livePerchanges = Array.isArray(liveObj.perchange) ? (liveObj.perchange as unknown[]) : []
    const liveVols = Array.isArray(liveObj.totalvol) ? (liveObj.totalvol as unknown[]) : []

    const liveDataMap = new Map<string, { price: number | null; changePct: number | null; vol: number | null }>()
    liveCodes.forEach((codeRaw, idx) => {
      const code = String(codeRaw || "").trim().toUpperCase()
      const rawPrice = parseNumeric(livePrices[idx])
      const price = rawPrice != null ? (rawPrice >= 500 ? rawPrice / 1000 : rawPrice) : null
      const perchange = parseNumeric(livePerchanges[idx])
      const vol = parseNumeric(liveVols[idx])
      if (code && (price != null || vol != null)) {
        liveDataMap.set(code, { price, changePct: perchange, vol })
      }
    })

    tickers.slice(0, 10).forEach((ticker) => {
      const live = liveDataMap.get(ticker)
      if (!live) return

      leaders.push({
        session_date: sessionDate,
        category: "top_volume",
        rank: leaders.length + 1,
        ticker,
        price: live.price,
        change_pct: live.changePct,
        estimated_index_points: null,
        metric_value: live.vol,
        metric_label: live.vol != null ? `${(live.vol / 1_000_000).toFixed(1)}M CP` : null,
        quality_status: "healthy",
        missing_fields: [],
        evidence_refs: [
          { field: "total_volume", source_class: "market_leaders", observed_at: asOfIso, unit: "shares" },
        ],
        source_timestamp: asOfIso,
        as_of: asOfIso,
      })
    })

    if (leaders.length > 0) coverage.get_live = true
  }

  // 9. Build compound staged items
  const staged_items: StagedItem<Record<string, unknown>>[] = []

  staged_items.push({
    staging_key: "daily:summary",
    category: "daily",
    payload: daily as unknown as Record<string, unknown>,
  })

  for (const idx of canonicalIndexes) {
    staged_items.push({
      staging_key: `index:${idx.index_code}`,
      category: "index",
      payload: idx as unknown as Record<string, unknown>,
    })
  }

  for (const sec of sectors) {
    staged_items.push({
      staging_key: `sector:${sec.sector_key}:${sec.time_window}`,
      category: "sector",
      payload: sec as unknown as Record<string, unknown>,
    })
  }

  for (const leader of leaders) {
    staged_items.push({
      staging_key: `leader:${leader.category}:${leader.rank}:${leader.ticker}`,
      category: "leader",
      payload: leader as unknown as Record<string, unknown>,
    })
  }

  const allP0Present =
    coverage.canonical_indexes &&
    coverage.market_pulse_content &&
    coverage.ma_breadth &&
    coverage.risk_indicator &&
    coverage.psychology_indicator &&
    coverage.cash_flows &&
    coverage.sector_pulse &&
    coverage.sector_breadth

  const overallQuality: QualityStatus = !allP0Present
    ? "failing"
    : daily.quality_status === "degraded"
      ? "degraded"
      : "healthy"

  return {
    session_date: sessionDate,
    contract_version: 1,
    daily,
    indexes: canonicalIndexes,
    sectors,
    leaders,
    staged_items,
    quality_status: overallQuality,
    endpoint_coverage: coverage,
    staged_counts: {
      daily: 1,
      index: canonicalIndexes.length,
      sector: sectors.length,
      leader: leaders.length,
      total: staged_items.length,
    },
  }
}

export function validateMarketCloseSnapshot(snapshot: NormalizedMarketSnapshot): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot.session_date)) {
    errors.push(`Invalid session_date: ${snapshot.session_date}`)
  }

  const requiredIndexes = ["VNINDEX", "VN30", "HNX", "UPCOM"] as const
  const indexMap = new Map(snapshot.indexes.map((idx) => [idx.index_code, idx]))
  for (const req of requiredIndexes) {
    const idx = indexMap.get(req)
    if (!idx) {
      errors.push(`Missing required index: ${req}`)
    } else if (idx.value == null || !Number.isFinite(idx.value) || idx.value <= 0) {
      errors.push(`Invalid index value for ${req}: ${idx.value}`)
    }
  }

  if (snapshot.daily.above_ma20_pct != null && (snapshot.daily.above_ma20_pct < 0 || snapshot.daily.above_ma20_pct > 100)) {
    errors.push(`Invalid above_ma20_pct: ${snapshot.daily.above_ma20_pct}`)
  }

  if (snapshot.daily.risk_score != null && (snapshot.daily.risk_score < 0 || snapshot.daily.risk_score > 100)) {
    errors.push(`Invalid risk_score: ${snapshot.daily.risk_score}`)
  }

  if (snapshot.daily.sentiment_score != null && (snapshot.daily.sentiment_score < 0 || snapshot.daily.sentiment_score > 100)) {
    errors.push(`Invalid sentiment_score: ${snapshot.daily.sentiment_score}`)
  }

  const seenStagingKeys = new Set<string>()
  for (const item of snapshot.staged_items) {
    if (!item.staging_key || seenStagingKeys.has(item.staging_key)) {
      errors.push(`Duplicate or missing staging_key: ${item.staging_key}`)
    }
    seenStagingKeys.add(item.staging_key)
  }

  return { valid: errors.length === 0, errors }
}
