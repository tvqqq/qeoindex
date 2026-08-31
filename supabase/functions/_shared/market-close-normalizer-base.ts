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
  source_class: "market_pulse" | "market_indexes" | "market_sectors" | "market_flows" | "market_leaders" | "market_valuation" | "canonical_market_feed"
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
  market_regime: MarketRegime | null
  sentiment_score: number | null
  sentiment_label: string | null
  risk_score: number | null
  risk_label: string | null
  distribution_count: number | null
  distribution_window: string | null
  sentiment_history: Array<{ trading_date: string; value: number }>
  risk_history: Array<{ trading_date: string; risk: number }>
  valuation_history: Array<{
    trading_date: string
    price: number | null
    pe: number | null
    pb: number | null
    pe_1std_up: number | null
    pe_1std_down: number | null
    pe_2std_up: number | null
    pe_2std_down: number | null
    pb_1std_up: number | null
    pb_1std_down: number | null
    pb_2std_up: number | null
    pb_2std_down: number | null
  }>
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
  close_price: number | null
  traded_value: number | null
  previous_traded_value: number | null
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
  ma10_state: "up" | "down" | null
  ma20_state: "up" | "down" | null
  ma50_state: "up" | "down" | null
  rotation_history: Array<{ trading_date: string; status: RotationState; close_price: number | null }>
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
  if (normalized.includes("lag") || normalized.includes("tụt hậu") || normalized.includes("đội sổ") || normalized.includes("lagging")) return "lagging"
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

// KFSP's getdatama socket uses the page's own slug contract, which deliberately
// preserves punctuation. Keep this separate from the DB-safe sector key.
export function normalizeSectorMaSlug(name: string): string {
  if (name.trim().toUpperCase() === "NÔNG - LÂM - NGƯ") return "nong_lam_ngu"
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, "_")
    .trim()
}

export function deriveRiskLabel(riskScore: number | null): string | null {
  if (riskScore == null) return null
  if (riskScore < 0.3) return "Thấp"
  if (riskScore <= 0.7) return "Trung tính"
  return "Cao"
}

export function deriveSentimentLabel(sentimentScore: number | null): string | null {
  if (sentimentScore == null) return null
  if (sentimentScore >= 80) return "Tham lam tột độ"
  if (sentimentScore >= 60) return "Tham lam"
  if (sentimentScore >= 40) return "Trung lập"
  if (sentimentScore >= 20) return "Sợ hãi"
  return "Sợ hãi tột độ"
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
  valuationPayload?: unknown
  valuationOk?: boolean
  sectorIbdPayload?: unknown
  sectorIbdOk?: boolean
  sectorRrgPayload?: unknown
  sectorRrgOk?: boolean
  sectorMaPayload?: unknown
  sectorMaOk?: boolean
  sectorBreadthPayload?: unknown
  sectorBreadthOk?: boolean
  cashFlowsPayload?: unknown
  cashFlowsOk?: boolean
  topVolatilityTickers?: unknown
  getLivePayload?: unknown
  getLiveOk?: boolean
  providerIndexes: NormalizedIndexRow[]
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
    valuationPayload,
    valuationOk = false,
    sectorIbdPayload,
    sectorIbdOk = false,
    sectorRrgPayload,
    sectorRrgOk = false,
    sectorMaPayload,
    sectorMaOk = false,
    sectorBreadthPayload,
    sectorBreadthOk = false,
    cashFlowsPayload,
    cashFlowsOk = false,
    topVolatilityTickers,
    getLivePayload,
    getLiveOk = false,
    providerIndexes,
  } = params

  const coverage: Record<string, boolean> = {
    market_pulse_content: false,
    ma_breadth: false,
    risk_indicator: false,
    psychology_indicator: false,
    valuation_history: false,
    sector_ibd: false,
    sector_pulse: false,
    sector_rrg: false,
    sector_ma: false,
    sector_breadth: false,
    cash_flows: false,
    get_live: false,
    canonical_indexes: providerIndexes.length === 4 && providerIndexes.every((i) => i.value != null && i.value > 0),
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
  const riskHistory: NormalizedDailySummary["risk_history"] = []
  if (riskOk && Array.isArray(riskPayload) && riskPayload.length > 0) {
    const first = asObject(riskPayload[0])
    const rawRisk = parseNumeric(first?.risk)
    if (rawRisk != null && rawRisk >= 0 && rawRisk <= 1) {
      coverage.risk_indicator = true
      riskScore = Number(rawRisk.toFixed(4))
      dailyEvidence.push({ field: "risk_score", source_class: "market_pulse", observed_at: asOfIso, unit: "ratio_0_1" })
    }
    for (const item of riskPayload) {
      const obj = asObject(item)
      const risk = parseNumeric(obj?.risk)
      const tradingDate = typeof obj?.tradingdate === "string" ? obj.tradingdate.slice(0, 10) : ""
      if (tradingDate && risk != null && risk >= 0 && risk <= 1) {
        riskHistory.push({ trading_date: tradingDate, risk: Number(risk.toFixed(4)) })
      }
    }
  }
  if (riskScore == null) dailyMissing.push("risk_score")

  // 4. Parse Psychology / Sentiment [ { value: number } ]
  let sentimentScore: number | null = null
  const sentimentHistory: NormalizedDailySummary["sentiment_history"] = []
  if (psychologyOk && Array.isArray(psychologyPayload) && psychologyPayload.length > 0) {
    const first = asObject(psychologyPayload[0])
    const rawVal = parseNumeric(first?.value)
    if (rawVal != null) {
      coverage.psychology_indicator = true
      sentimentScore = clampPercent(rawVal)
      dailyEvidence.push({ field: "sentiment_score", source_class: "market_pulse", observed_at: asOfIso, unit: "score_0_100" })
    }
    for (const item of psychologyPayload) {
      const obj = asObject(item)
      const value = parseNumeric(obj?.value)
      const tradingDate = typeof obj?.tradingdate === "string" ? obj.tradingdate.slice(0, 10) : ""
      if (tradingDate && value != null && value >= 0 && value <= 100) {
        sentimentHistory.push({ trading_date: tradingDate, value: Number(value.toFixed(2)) })
      }
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

  // 6. KFSP canonical indexes
  const vnindex = providerIndexes.find((i) => i.index_code === "VNINDEX")
  const totalVolume = vnindex?.matched_volume ?? null
  const totalValue = vnindex?.traded_value ?? null

  const sentimentLabel = deriveSentimentLabel(sentimentScore)
  const riskLabel = deriveRiskLabel(riskScore)

  const valuationHistory: NormalizedDailySummary["valuation_history"] = []
  if (valuationOk && Array.isArray(valuationPayload)) {
    for (const item of valuationPayload) {
      const obj = asObject(item)
      const tradingDate = typeof obj?.tradingdate === "string" ? obj.tradingdate.slice(0, 10) : ""
      if (!tradingDate) continue
      const point = {
        trading_date: tradingDate,
        price: parseNumeric(obj?.price),
        pe: parseNumeric(obj?.pe),
        pb: parseNumeric(obj?.pb),
        pe_1std_up: parseNumeric(obj?.pe_1std_up),
        pe_1std_down: parseNumeric(obj?.pe_1std_down),
        pe_2std_up: parseNumeric(obj?.pe_2std_up),
        pe_2std_down: parseNumeric(obj?.pe_2std_down),
        pb_1std_up: parseNumeric(obj?.pb_1std_up),
        pb_1std_down: parseNumeric(obj?.pb_1std_down),
        pb_2std_up: parseNumeric(obj?.pb_2std_up),
        pb_2std_down: parseNumeric(obj?.pb_2std_down),
      }
      if (point.price != null && (point.pe != null || point.pb != null)) valuationHistory.push(point)
    }
    coverage.valuation_history = valuationHistory.length > 0
  }

  const dailyQuality: QualityStatus = dailyMissing.length > 2 ? "degraded" : "healthy"

  const daily: NormalizedDailySummary = {
    session_date: sessionDate,
    market_regime: null,
    sentiment_score: sentimentScore,
    sentiment_label: sentimentLabel,
    risk_score: riskScore,
    risk_label: riskLabel,
    distribution_count: distributionCount != null ? Math.max(0, Math.round(distributionCount)) : null,
    distribution_window: null,
    sentiment_history: sentimentHistory.reverse(),
    risk_history: riskHistory.reverse(),
    valuation_history: valuationHistory.reverse(),
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
  const secObj = asObject(sectorIbdPayload)
  if (sectorIbdOk && secObj && Array.isArray(secObj.ten_nganh)) {
    const names = secObj.ten_nganh as unknown[]
    const closes = Array.isArray(secObj.closeprice) ? secObj.closeprice as unknown[] : []
    const rsScores = Array.isArray(secObj.rss) ? secObj.rss as unknown[] : []
    const currentValues = Array.isArray(secObj.totalval_market_pulse) ? secObj.totalval_market_pulse as unknown[] : []
    const previousValues = Array.isArray(secObj.totalvalbefore_market_pulse) ? secObj.totalvalbefore_market_pulse as unknown[] : []
    const efforts = Array.isArray(secObj.percent_market_pulse) ? secObj.percent_market_pulse as unknown[] : []
    const results = Array.isArray(secObj.percent_market_pulse_marketcap) ? secObj.percent_market_pulse_marketcap as unknown[] : []

    names.forEach((nameRaw, idx) => {
      const displayName = String(nameRaw || "").trim()
      const slug = normalizeSectorSlug(displayName)
      const resultPct = parseNumeric(results[idx])
      if (!slug || resultPct == null) return
      const tradedVal = parseNumeric(currentValues[idx])
      const previousTradedVal = parseNumeric(previousValues[idx])
      const rsScore = parseNumeric(rsScores[idx])
      const effortPct = parseNumeric(efforts[idx])

      sectorMap.set(slug, {
        session_date: sessionDate,
        sector_key: slug,
        time_window: "1d",
        display_name: displayName,
        close_price: parseNumeric(closes[idx]),
        traded_value: tradedVal,
        previous_traded_value: previousTradedVal,
        average_change_pct: resultPct,
        advances: 0,
        unchanged: 0,
        declines: 0,
        rs_score: rsScore,
        rotation_state: "unknown",
        strength_ratio: null,
        momentum_ratio: null,
        effort_pct: effortPct,
        result_pct: resultPct,
        effort_result_state: null,
        ma10_state: null,
        ma20_state: null,
        ma50_state: null,
        rotation_history: [],
        quality_status: "healthy",
        missing_fields: [],
        evidence_refs: [
          { field: "rs_score", source_class: "market_sectors", observed_at: asOfIso, unit: "score_0_100" },
          { field: "effort_pct", source_class: "market_sectors", observed_at: asOfIso, unit: "%" },
          { field: "result_pct", source_class: "market_sectors", observed_at: asOfIso, unit: "%" },
        ],
        source_timestamp: asOfIso,
        as_of: asOfIso,
      })
    })

    if (sectorMap.size > 0) {
      coverage.sector_ibd = true
      // Compatibility alias for the v1 atomic publisher guard.
      coverage.sector_pulse = true
    }
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

  const sectorList = Array.from(sectorMap.values())

  const rrgObj = asObject(sectorRrgPayload)
  let rrgCount = 0
  if (sectorRrgOk && rrgObj) {
    for (const sec of sectorList) {
      const records = Array.isArray(rrgObj[sec.display_name]) ? rrgObj[sec.display_name] as unknown[] : []
      const history = records.flatMap((record) => {
        const obj = asObject(record)
        const tradingDate = typeof obj?.tradingdate === "string" ? obj.tradingdate.slice(0, 10) : ""
        const state = mapRotationState(obj?.status)
        return tradingDate && state !== "unknown"
          ? [{ trading_date: tradingDate, status: state, close_price: parseNumeric(obj?.closeprice) }]
          : []
      })
      if (history.length > 0) {
        sec.rotation_history = history
        sec.rotation_state = history[history.length - 1].status
        sec.evidence_refs.push({ field: "rotation_state", source_class: "market_sectors", observed_at: asOfIso })
        rrgCount += 1
      }
    }
  }
  coverage.sector_rrg = sectorList.length > 0 && rrgCount === sectorList.length

  const sectorMaObj = asObject(sectorMaPayload)
  let maCount = 0
  if (sectorMaOk && sectorMaObj) {
    for (const sec of sectorList) {
      const raw = asObject(sectorMaObj[sec.display_name]) || asObject(sectorMaObj[sec.sector_key])
      const ma10 = raw?.ma10 === "up" || raw?.ma10 === "down" ? raw.ma10 : null
      const ma20 = raw?.ma20 === "up" || raw?.ma20 === "down" ? raw.ma20 : null
      const ma50 = raw?.ma50 === "up" || raw?.ma50 === "down" ? raw.ma50 : null
      sec.ma10_state = ma10
      sec.ma20_state = ma20
      sec.ma50_state = ma50
      if (ma10 && ma20 && ma50) maCount += 1
    }
  }
  coverage.sector_ma = sectorList.length > 0 && maCount === sectorList.length

  const sectors = sectorList

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

  for (const idx of providerIndexes) {
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
    coverage.valuation_history &&
    coverage.sector_ibd &&
    coverage.sector_breadth &&
    coverage.sector_rrg &&
    coverage.sector_ma

  const overallQuality: QualityStatus = !allP0Present
    ? "failing"
    : daily.quality_status === "degraded"
      ? "degraded"
      : "healthy"

  return {
    session_date: sessionDate,
    contract_version: 2,
    daily,
    indexes: providerIndexes,
    sectors,
    leaders,
    staged_items,
    quality_status: overallQuality,
    endpoint_coverage: coverage,
    staged_counts: {
      daily: 1,
      index: providerIndexes.length,
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

  if (snapshot.daily.risk_score != null && (snapshot.daily.risk_score < 0 || snapshot.daily.risk_score > 1)) {
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
