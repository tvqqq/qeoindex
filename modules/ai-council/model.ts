export type CouncilTimeframe = "1W" | "1D" | "4H" | "1H"
export type CouncilDirectionalStance = "bullish" | "neutral" | "bearish"
export type CouncilRiskStance = "approve" | "caution" | "veto"
export type CouncilSignal = "BUY" | "BUY_ON_CONFIRMATION" | "WAIT" | "REDUCE" | "SELL"
export type CouncilConfidence = "HIGH" | "MEDIUM" | "LOW"

export interface CouncilFundamentalEvidence {
  revenueGrowthPct: number | null
  netIncomeGrowthPct: number | null
  roePct: number | null
  roaPct: number | null
  netMarginPct: number | null
}

export interface CouncilTechnicalEvidence {
  priceVsSma10Pct: number | null
  priceVsSma20Pct: number | null
  priceVsSma50Pct: number | null
  priceVsSma100Pct: number | null
  priceVsSma200Pct: number | null
  macdVsSignal: string | null
}

export interface CouncilLiquidityEvidence {
  volume1d: number | null
  averageVolume10d: number | null
  averageVolume20d: number | null
  averageVolume50d: number | null
  volumeVsPreviousSessionPct: number | null
  tradedValueVsPreviousSessionPct: number | null
}

export interface CouncilFlowEvidence {
  netForeignTradingBillion: number | null
  netProprietaryTradingBillion: number | null
}

export interface CouncilRatingEvidence {
  ticker: string
  companyName: string
  sector: string
  exchange: string | null
  rank: number | null
  price: number | null
  changePct: number | null
  ratingScore: number | null
  score4m: number | null
  canslimScore: number | null
  pricePotential: string | null
  stockRsScore: number | null
  sectorRsScore: number | null
  rsShort: number | null
  rsMedium: number | null
  stockRrgState: string | null
  sectorRrgState: string | null
  weeklyChangePct: number | null
  monthlyChangePct: number | null
  beta: number | null
  peTtm: number | null
  pbTtm: number | null
  fundamentals: CouncilFundamentalEvidence
  technical: CouncilTechnicalEvidence
  liquidity: CouncilLiquidityEvidence
  flow: CouncilFlowEvidence
}

export interface CouncilWyckoffEvidence {
  timeframe: CouncilTimeframe
  barClosedAt: string | null
  phase: string
  state: string
  bias: string
  confidence: string
  bullProbability: number | null
  baseProbability: number | null
  bearProbability: number | null
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  whatChanged: string
  price: number | null
  changePct: number | null
  relVolume: number | null
  provider: string
  providerDetail: string
  derived: boolean | null
}

export interface CouncilAgentOpinion {
  key: "wyckoff" | "momentum" | "fundamental" | "flow" | "market" | "risk"
  label: string
  role: string
  score: number
  confidence: number
  stance: CouncilDirectionalStance | CouncilRiskStance
  summary: string
  evidenceFor: string[]
  evidenceAgainst: string[]
}

export interface AiCouncilStock {
  ticker: string
  companyName: string
  sector: string
  exchange: string | null
  rank: number | null
  price: number | null
  changePct: number | null
  signal: CouncilSignal
  signalLabel: string
  councilScore: number
  confidence: number
  consensus: number
  consensusLabel: string
  bullVotes: number
  neutralVotes: number
  bearVotes: number
  riskStatus: CouncilRiskStance
  confirmationPending: boolean
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  dataQuality: CouncilConfidence
  dataQualityDetail: string
  asOf: string | null
  agents: CouncilAgentOpinion[]
  bullCase: string[]
  bearCase: string[]
  dissent: string
  whatChangesDecision: string[]
}

const DIRECTIONAL_WEIGHTS = {
  wyckoff: 0.3,
  momentum: 0.2,
  fundamental: 0.2,
  flow: 0.15,
  market: 0.15,
} as const

const TIMEFRAME_WEIGHTS: Record<CouncilTimeframe, number> = {
  "1W": 0.35,
  "1D": 0.35,
  "4H": 0.2,
  "1H": 0.1,
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number) {
  return Math.round(clamp(value))
}

function average(values: Array<number | null | undefined>) {
  const clean = values.filter((value): value is number => value != null && Number.isFinite(value))
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null
}

function directionalStance(score: number): CouncilDirectionalStance {
  if (score >= 60) return "bullish"
  if (score <= 40) return "bearish"
  return "neutral"
}

function confidenceWeight(value: string) {
  const normalized = value.trim().toUpperCase()
  if (normalized === "HIGH") return 1
  if (normalized === "MEDIUM") return 0.82
  if (normalized === "LOW") return 0.58
  return 0.7
}

function biasAdjustment(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes("bull")) return 8
  if (normalized.includes("bear")) return -8
  return 0
}

function rrgAdjustment(value: string | null) {
  const normalized = (value || "").toLowerCase()
  if (normalized.includes("dẫn dắt") || normalized.includes("leading")) return 10
  if (normalized.includes("cải thiện") || normalized.includes("improving")) return 6
  if (normalized.includes("suy yếu") || normalized.includes("weakening")) return -6
  if (normalized.includes("tụt hậu") || normalized.includes("lagging")) return -10
  return 0
}

function pctScore(value: number | null, multiplier: number) {
  if (value == null) return null
  return clamp(50 + value * multiplier)
}

function growthScore(value: number | null, multiplier: number) {
  if (value == null) return null
  return clamp(50 + value * multiplier)
}

function signedText(value: number | null, suffix = "%") {
  if (value == null) return "—"
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`
}

function formatNumber(value: number | null, digits = 1) {
  if (value == null) return "—"
  return value.toLocaleString("vi-VN", { maximumFractionDigits: digits })
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))]
}

function buildWyckoffAgent(snapshots: CouncilWyckoffEvidence[]): CouncilAgentOpinion {
  const byTimeframe = new Map(snapshots.map((item) => [item.timeframe, item]))
  let weighted = 0
  let totalWeight = 0
  const evidenceFor: string[] = []
  const evidenceAgainst: string[] = []

  for (const timeframe of ["1W", "1D", "4H", "1H"] as CouncilTimeframe[]) {
    const snapshot = byTimeframe.get(timeframe)
    if (!snapshot) continue
    const bull = snapshot.bullProbability ?? 33
    const bear = snapshot.bearProbability ?? 33
    const directional = clamp(50 + (bull - bear) * 0.7 + biasAdjustment(snapshot.bias))
    const weight = TIMEFRAME_WEIGHTS[timeframe] * confidenceWeight(snapshot.confidence)
    weighted += directional * weight
    totalWeight += weight

    const phrase = `${timeframe}: ${snapshot.phase || snapshot.state || snapshot.bias || "chưa phân loại"}`
    if (directional >= 58) evidenceFor.push(phrase)
    else if (directional <= 42) evidenceAgainst.push(phrase)
  }

  const score = round(totalWeight ? weighted / totalWeight : 50)
  const daily = byTimeframe.get("1D")
  const weekly = byTimeframe.get("1W")
  const confidence = round(55 + Math.min(35, snapshots.length * 7) - (snapshots.some((item) => item.confidence.toUpperCase() === "LOW") ? 8 : 0))

  if (daily?.confirmation) evidenceFor.push(`Xác nhận cần theo dõi: ${daily.confirmation}`)
  if (daily?.invalidation) evidenceAgainst.push(`Invalidation: ${daily.invalidation}`)
  if (weekly && daily && directionalStance(score) !== directionalStance(clamp(50 + ((weekly.bullProbability ?? 33) - (weekly.bearProbability ?? 33)) * 0.7 + biasAdjustment(weekly.bias)))) {
    evidenceAgainst.push(`Xung đột HTF: Weekly ${weekly.bias || weekly.phase}, Daily ${daily.bias || daily.phase}`)
  }

  return {
    key: "wyckoff",
    label: "Wyckoff Strategist",
    role: "Structure · Price/Volume · MTF",
    score,
    confidence,
    stance: directionalStance(score),
    summary: daily?.state || daily?.phase || "Chưa đủ snapshot Wyckoff để phân loại chắc chắn.",
    evidenceFor: unique(evidenceFor).slice(0, 3),
    evidenceAgainst: unique(evidenceAgainst).slice(0, 3),
  }
}

function buildMomentumAgent(rating: CouncilRatingEvidence): CouncilAgentOpinion {
  const smaScores = [
    rating.technical.priceVsSma10Pct,
    rating.technical.priceVsSma20Pct,
    rating.technical.priceVsSma50Pct,
    rating.technical.priceVsSma100Pct,
    rating.technical.priceVsSma200Pct,
  ].map((value) => pctScore(value, 4))
  const smaScore = average(smaScores)
  const parts = [
    { value: rating.score4m, weight: 0.28 },
    { value: rating.rsShort, weight: 0.2 },
    { value: rating.rsMedium, weight: 0.14 },
    { value: smaScore, weight: 0.2 },
    { value: pctScore(rating.weeklyChangePct, 2.5), weight: 0.08 },
    { value: pctScore(rating.monthlyChangePct, 1.5), weight: 0.1 },
  ]
  let weighted = 0
  let totalWeight = 0
  for (const part of parts) {
    if (part.value == null) continue
    weighted += part.value * part.weight
    totalWeight += part.weight
  }
  const rrg = rrgAdjustment(rating.stockRrgState)
  const macd = (rating.technical.macdVsSignal || "").toLowerCase()
  const macdAdj = macd.includes("trên") || macd.includes("above") ? 4 : macd.includes("dưới") || macd.includes("below") ? -4 : 0
  const score = round((totalWeight ? weighted / totalWeight : 50) + rrg + macdAdj)
  const evidenceFor: string[] = []
  const evidenceAgainst: string[] = []

  if ((rating.rsShort ?? 50) >= 55) evidenceFor.push(`RS ngắn hạn ${formatNumber(rating.rsShort)}/100`)
  if ((rating.rsMedium ?? 50) >= 55) evidenceFor.push(`RS trung hạn ${formatNumber(rating.rsMedium)}/100`)
  if ((rating.weeklyChangePct ?? 0) > 0) evidenceFor.push(`1W ${signedText(rating.weeklyChangePct)}`)
  if ((rating.monthlyChangePct ?? 0) > 0) evidenceFor.push(`1M ${signedText(rating.monthlyChangePct)}`)
  if ((rating.technical.priceVsSma200Pct ?? 0) < 0) evidenceAgainst.push(`Giá còn dưới SMA200 ${signedText(rating.technical.priceVsSma200Pct)}`)
  if ((rating.score4m ?? 50) < 45) evidenceAgainst.push(`4M score thấp ${formatNumber(rating.score4m)}/100`)
  if (rrg < 0) evidenceAgainst.push(`RRG cổ phiếu: ${rating.stockRrgState}`)

  return {
    key: "momentum",
    label: "Momentum Quant",
    role: "Trend · Momentum · Relative Strength",
    score,
    confidence: round(58 + parts.filter((part) => part.value != null).length * 5),
    stance: directionalStance(score),
    summary: score >= 60 ? "Động lượng và relative strength đang nghiêng tích cực." : score <= 40 ? "Động lượng chưa ủng hộ vị thế mua mới." : "Momentum đang ở vùng trung tính, cần thêm follow-through.",
    evidenceFor: unique(evidenceFor).slice(0, 3),
    evidenceAgainst: unique(evidenceAgainst).slice(0, 3),
  }
}

function valuationScore(pe: number | null, pb: number | null) {
  const values: number[] = []
  if (pe != null && pe > 0) values.push(clamp(72 - Math.max(0, pe - 10) * 1.5))
  if (pb != null && pb > 0) values.push(clamp(68 - Math.max(0, pb - 1.5) * 5))
  return values.length ? average(values) : null
}

function buildFundamentalAgent(rating: CouncilRatingEvidence): CouncilAgentOpinion {
  const f = rating.fundamentals
  const parts = [
    { value: rating.canslimScore, weight: 0.3 },
    { value: growthScore(f.revenueGrowthPct, 1.4), weight: 0.17 },
    { value: growthScore(f.netIncomeGrowthPct, 0.35), weight: 0.2 },
    { value: f.roePct == null ? null : clamp(35 + f.roePct * 2.2), weight: 0.14 },
    { value: f.netMarginPct == null ? null : clamp(42 + f.netMarginPct * 1.5), weight: 0.09 },
    { value: valuationScore(rating.peTtm, rating.pbTtm), weight: 0.1 },
  ]
  let weighted = 0
  let totalWeight = 0
  for (const part of parts) {
    if (part.value == null) continue
    weighted += part.value * part.weight
    totalWeight += part.weight
  }
  const score = round(totalWeight ? weighted / totalWeight : rating.ratingScore ?? 50)
  const evidenceFor: string[] = []
  const evidenceAgainst: string[] = []

  if ((rating.canslimScore ?? 0) >= 65) evidenceFor.push(`CANSLIM ${formatNumber(rating.canslimScore)}/100`)
  if ((f.revenueGrowthPct ?? 0) > 8) evidenceFor.push(`Doanh thu TTM ${signedText(f.revenueGrowthPct)}`)
  if ((f.netIncomeGrowthPct ?? 0) > 10) evidenceFor.push(`LNST TTM ${signedText(f.netIncomeGrowthPct)}`)
  if ((f.roePct ?? 0) >= 15) evidenceFor.push(`ROE ${formatNumber(f.roePct)}%`)
  if ((f.netIncomeGrowthPct ?? 0) < 0) evidenceAgainst.push(`LNST suy giảm ${signedText(f.netIncomeGrowthPct)}`)
  if ((f.revenueGrowthPct ?? 0) < 0) evidenceAgainst.push(`Doanh thu suy giảm ${signedText(f.revenueGrowthPct)}`)
  if ((rating.peTtm ?? 0) > 30) evidenceAgainst.push(`P/E TTM ${formatNumber(rating.peTtm)}x cần premium growth`)

  return {
    key: "fundamental",
    label: "Fundamental Analyst",
    role: "Earnings quality · Growth · Valuation",
    score,
    confidence: round(52 + parts.filter((part) => part.value != null).length * 6),
    stance: directionalStance(score),
    summary: score >= 60 ? "Nền tảng lợi nhuận hỗ trợ conviction trung hạn." : score <= 40 ? "Fundamental chưa tạo đủ margin of safety cho thesis." : "Fundamental cân bằng; catalyst cần được price action xác nhận.",
    evidenceFor: unique(evidenceFor).slice(0, 3),
    evidenceAgainst: unique(evidenceAgainst).slice(0, 3),
  }
}

function flowDirectionalScore(value: number | null, scale: number) {
  if (value == null) return null
  return clamp(50 + Math.sign(value) * Math.min(22, Math.abs(value) / scale))
}

function buildFlowAgent(rating: CouncilRatingEvidence, snapshots: CouncilWyckoffEvidence[]): CouncilAgentOpinion {
  const daily = snapshots.find((item) => item.timeframe === "1D")
  const priceDirection = Math.sign(rating.changePct ?? daily?.changePct ?? 0)
  const relVolume = daily?.relVolume ?? null
  const relVolumeScore = relVolume == null ? null : clamp(50 + priceDirection * Math.min(24, Math.max(0, relVolume - 1) * 22))
  const volumeChange = rating.liquidity.volumeVsPreviousSessionPct
  const volumeChangeScore = volumeChange == null ? null : clamp(50 + priceDirection * Math.min(18, Math.abs(volumeChange) * 0.16))
  const tradedValueChange = rating.liquidity.tradedValueVsPreviousSessionPct
  const tradedValueScore = tradedValueChange == null ? null : clamp(50 + priceDirection * Math.min(18, Math.abs(tradedValueChange) * 0.14))
  const foreignScore = flowDirectionalScore(rating.flow.netForeignTradingBillion, 3)
  const proprietaryScore = flowDirectionalScore(rating.flow.netProprietaryTradingBillion, 2)
  const score = round(average([relVolumeScore, volumeChangeScore, tradedValueScore, foreignScore, proprietaryScore]) ?? 50)
  const evidenceFor: string[] = []
  const evidenceAgainst: string[] = []

  if ((relVolume ?? 0) >= 1.3 && priceDirection > 0) evidenceFor.push(`RelVolume D1 ${formatNumber(relVolume, 2)}x đi cùng giá tăng`)
  if ((rating.flow.netForeignTradingBillion ?? 0) > 0) evidenceFor.push(`Khối ngoại ròng +${formatNumber(rating.flow.netForeignTradingBillion)} tỷ`)
  if ((rating.flow.netProprietaryTradingBillion ?? 0) > 0) evidenceFor.push(`Tự doanh ròng +${formatNumber(rating.flow.netProprietaryTradingBillion)} tỷ`)
  if ((relVolume ?? 0) >= 1.3 && priceDirection < 0) evidenceAgainst.push(`RelVolume D1 ${formatNumber(relVolume, 2)}x đi cùng giá giảm`)
  if ((rating.flow.netForeignTradingBillion ?? 0) < 0) evidenceAgainst.push(`Khối ngoại ròng ${formatNumber(rating.flow.netForeignTradingBillion)} tỷ`)
  if ((rating.flow.netProprietaryTradingBillion ?? 0) < 0) evidenceAgainst.push(`Tự doanh ròng ${formatNumber(rating.flow.netProprietaryTradingBillion)} tỷ`)

  return {
    key: "flow",
    label: "Flow Analyst",
    role: "Liquidity · Volume · Money flow",
    score,
    confidence: round(50 + [relVolumeScore, volumeChangeScore, tradedValueScore, foreignScore, proprietaryScore].filter((value) => value != null).length * 7),
    stance: directionalStance(score),
    summary: score >= 60 ? "Dòng tiền xác nhận theo hướng tích cực." : score <= 40 ? "Dòng tiền cho thấy supply/withdrawal risk cần ưu tiên." : "Dòng tiền chưa tạo lợi thế rõ ràng cho một phía.",
    evidenceFor: unique(evidenceFor).slice(0, 3),
    evidenceAgainst: unique(evidenceAgainst).slice(0, 3),
  }
}

function buildMarketAgent(rating: CouncilRatingEvidence): CouncilAgentOpinion {
  const stockRs = average([rating.stockRsScore, rating.rsShort, rating.rsMedium]) ?? 50
  const sectorRs = rating.sectorRsScore ?? 50
  const relativeEdge = clamp(50 + (stockRs - sectorRs) * 1.7)
  const score = round(relativeEdge + rrgAdjustment(rating.stockRrgState) * 0.7 + rrgAdjustment(rating.sectorRrgState) * 0.35)
  const evidenceFor: string[] = []
  const evidenceAgainst: string[] = []

  if (stockRs > sectorRs + 2) evidenceFor.push(`RS cổ phiếu ${formatNumber(stockRs)} > RS ngành ${formatNumber(sectorRs)}`)
  if (rrgAdjustment(rating.stockRrgState) > 0) evidenceFor.push(`RRG cổ phiếu: ${rating.stockRrgState}`)
  if (rrgAdjustment(rating.sectorRrgState) > 0) evidenceFor.push(`RRG ngành: ${rating.sectorRrgState}`)
  if (stockRs < sectorRs - 2) evidenceAgainst.push(`RS cổ phiếu ${formatNumber(stockRs)} < RS ngành ${formatNumber(sectorRs)}`)
  if (rrgAdjustment(rating.sectorRrgState) < 0) evidenceAgainst.push(`RRG ngành: ${rating.sectorRrgState}`)
  evidenceAgainst.push("Council V1 chưa có canonical VNINDEX regime snapshot riêng theo ngày.")

  return {
    key: "market",
    label: "Market Strategist",
    role: "Relative Strength · Sector context",
    score,
    confidence: 62,
    stance: directionalStance(score),
    summary: score >= 60 ? "Cổ phiếu đang có relative tailwind so với ngành." : score <= 40 ? "Relative strength và sector context đang là headwind." : "Market context hiện chưa tạo edge đủ lớn.",
    evidenceFor: unique(evidenceFor).slice(0, 3),
    evidenceAgainst: unique(evidenceAgainst).slice(0, 3),
  }
}

function buildRiskAgent(rating: CouncilRatingEvidence, snapshots: CouncilWyckoffEvidence[], directionalAgents: CouncilAgentOpinion[]): CouncilAgentOpinion {
  const daily = snapshots.find((item) => item.timeframe === "1D")
  const weekly = snapshots.find((item) => item.timeframe === "1W")
  const issues: string[] = []
  let riskPoints = 0

  const dailyStance = daily ? directionalStance(clamp(50 + ((daily.bullProbability ?? 33) - (daily.bearProbability ?? 33)) * 0.7 + biasAdjustment(daily.bias))) : "neutral"
  const weeklyStance = weekly ? directionalStance(clamp(50 + ((weekly.bullProbability ?? 33) - (weekly.bearProbability ?? 33)) * 0.7 + biasAdjustment(weekly.bias))) : "neutral"
  if (daily && weekly && dailyStance !== "neutral" && weeklyStance !== "neutral" && dailyStance !== weeklyStance) {
    riskPoints += 20
    issues.push(`Timeframe conflict: Weekly ${weeklyStance}, Daily ${dailyStance}.`)
  }

  const dailyText = `${daily?.phase || ""} ${daily?.state || ""}`.toLowerCase()
  if (/candidate|chưa coi|chưa xác nhận|watch/.test(dailyText)) {
    riskPoints += 14
    issues.push("Daily setup vẫn là candidate/watch; chưa hoàn tất Hold → Test → Follow-through.")
  }
  if ((rating.technical.priceVsSma200Pct ?? 0) < 0) {
    riskPoints += 12
    issues.push(`Giá còn dưới SMA200 ${signedText(rating.technical.priceVsSma200Pct)}.`)
  }
  if (snapshots.some((item) => item.provider.toLowerCase().includes("fallback") || item.providerDetail.toLowerCase().includes("fallback"))) {
    riskPoints += 8
    issues.push("Một phần Wyckoff evidence đang dùng provider fallback.")
  }
  if (snapshots.some((item) => item.confidence.toUpperCase() === "LOW")) {
    riskPoints += 8
    issues.push("Có timeframe Wyckoff confidence LOW.")
  }
  if ((rating.beta ?? 0) > 1.4) {
    riskPoints += 8
    issues.push(`Beta ${formatNumber(rating.beta, 2)} làm tăng execution risk.`)
  }
  if (snapshots.length < 2) {
    riskPoints += 20
    issues.push("Thiếu multi-timeframe Wyckoff evidence.")
  }

  const scoreSpread = Math.max(...directionalAgents.map((agent) => agent.score)) - Math.min(...directionalAgents.map((agent) => agent.score))
  if (scoreSpread >= 35) {
    riskPoints += 8
    issues.push("Council disagreement lớn giữa các specialist agents.")
  }

  const score = round(100 - riskPoints)
  const stance: CouncilRiskStance = score < 30 ? "veto" : score < 70 ? "caution" : "approve"
  const evidenceFor = stance === "approve" ? ["Không phát hiện structural risk đủ lớn để chặn signal."] : []
  const evidenceAgainst = unique(issues)

  return {
    key: "risk",
    label: "Risk / Devil's Advocate",
    role: "Conflict · Invalidation · Data quality",
    score,
    confidence: round(70 + Math.min(20, snapshots.length * 4)),
    stance,
    summary: stance === "approve" ? "Risk audit APPROVE: chưa có điều kiện veto." : stance === "veto" ? "Risk audit VETO: không cho phép Council phát BUY mới." : `Risk audit CAUTION: ${issues[0] || "cần thêm xác nhận trước khi tăng conviction."}`,
    evidenceFor,
    evidenceAgainst: evidenceAgainst.slice(0, 4),
  }
}

function signalLabel(signal: CouncilSignal) {
  if (signal === "BUY") return "BUY"
  if (signal === "BUY_ON_CONFIRMATION") return "BUY ON CONFIRMATION"
  if (signal === "WAIT") return "WAIT"
  if (signal === "REDUCE") return "REDUCE"
  return "SELL / AVOID"
}

function chooseSignal(score: number, risk: CouncilRiskStance, confirmationPending: boolean): CouncilSignal {
  if (score >= 72 && risk === "approve" && !confirmationPending) return "BUY"
  if (score >= 60) return risk === "veto" ? "WAIT" : "BUY_ON_CONFIRMATION"
  if (score >= 47) return "WAIT"
  if (score >= 38) return "REDUCE"
  return "SELL"
}

function consensusLabel(value: number) {
  if (value >= 80) return "Rất cao"
  if (value >= 60) return "Khá cao"
  if (value >= 45) return "Trung bình"
  return "Phân hóa"
}

function inferDataQuality(snapshots: CouncilWyckoffEvidence[]): { quality: CouncilConfidence; detail: string } {
  if (!snapshots.length) return { quality: "LOW", detail: "Thiếu Wyckoff snapshots; Council chỉ còn rating/fundamental evidence." }
  const fallback = snapshots.some((item) => item.provider.toLowerCase().includes("fallback") || item.providerDetail.toLowerCase().includes("fallback"))
  const low = snapshots.some((item) => item.confidence.toUpperCase() === "LOW")
  if (snapshots.length < 3 || low) return { quality: "LOW", detail: "Multi-timeframe evidence chưa đầy đủ hoặc có timeframe confidence LOW." }
  if (fallback) return { quality: "MEDIUM", detail: "Đủ multi-timeframe nhưng có provider fallback; signal cần giữ margin of safety." }
  return { quality: "HIGH", detail: "Multi-timeframe snapshots đầy đủ và không phát hiện provider fallback." }
}

export function buildCouncilStock(rating: CouncilRatingEvidence, snapshots: CouncilWyckoffEvidence[]): AiCouncilStock {
  const wyckoff = buildWyckoffAgent(snapshots)
  const momentum = buildMomentumAgent(rating)
  const fundamental = buildFundamentalAgent(rating)
  const flow = buildFlowAgent(rating, snapshots)
  const market = buildMarketAgent(rating)
  const directionalAgents = [wyckoff, momentum, fundamental, flow, market]
  const risk = buildRiskAgent(rating, snapshots, directionalAgents)
  const agents = [...directionalAgents, risk]

  const weightedScore = directionalAgents.reduce((sum, agent) => sum + agent.score * DIRECTIONAL_WEIGHTS[agent.key as keyof typeof DIRECTIONAL_WEIGHTS], 0)
  const councilScore = round(weightedScore)
  const daily = snapshots.find((item) => item.timeframe === "1D")
  const dailyText = `${daily?.phase || ""} ${daily?.state || ""}`.toLowerCase()
  const confirmationPending = /candidate|chưa coi|chưa xác nhận|watch/.test(dailyText)
  const signal = chooseSignal(councilScore, risk.stance as CouncilRiskStance, confirmationPending)

  const bullVotes = directionalAgents.filter((agent) => agent.stance === "bullish").length
  const neutralVotes = directionalAgents.filter((agent) => agent.stance === "neutral").length
  const bearVotes = directionalAgents.filter((agent) => agent.stance === "bearish").length
  const consensus = round(Math.max(bullVotes, neutralVotes, bearVotes) / directionalAgents.length * 100)
  const scoreAverage = average(directionalAgents.map((agent) => agent.score)) ?? 50
  const variance = average(directionalAgents.map((agent) => (agent.score - scoreAverage) ** 2)) ?? 0
  const dispersion = Math.sqrt(variance)
  const baseConfidence = average(directionalAgents.map((agent) => agent.confidence)) ?? 55
  const confidence = round(baseConfidence - dispersion * 0.45 - (risk.stance === "caution" ? 5 : risk.stance === "veto" ? 12 : 0))

  const bullish = [...directionalAgents]
    .sort((left, right) => right.score - left.score)
    .flatMap((agent) => agent.evidenceFor.slice(0, 1).map((item) => `${agent.label}: ${item}`))
  const bearish = [...directionalAgents]
    .sort((left, right) => left.score - right.score)
    .flatMap((agent) => agent.evidenceAgainst.slice(0, 1).map((item) => `${agent.label}: ${item}`))
  const bullCase = unique(bullish).slice(0, 4)
  const bearCase = unique([...bearish, ...risk.evidenceAgainst.map((item) => `Risk: ${item}`)]).slice(0, 4)

  const majority: CouncilDirectionalStance = bullVotes > bearVotes && bullVotes >= neutralVotes ? "bullish" : bearVotes > bullVotes && bearVotes >= neutralVotes ? "bearish" : "neutral"
  const dissenter = directionalAgents
    .filter((agent) => agent.stance !== majority)
    .sort((left, right) => Math.abs(right.score - councilScore) - Math.abs(left.score - councilScore))[0]
  const dissent = risk.stance !== "approve"
    ? risk.summary
    : dissenter
      ? `${dissenter.label} không đồng thuận với majority: ${dissenter.summary}`
      : "Council chưa có minority view đủ mạnh để thay đổi quyết định hiện tại."

  const whatChangesDecision = unique([
    daily?.confirmation ? `Tăng conviction khi: ${daily.confirmation}` : "Tăng conviction khi breakout được Hold → Test → Follow-through.",
    daily?.invalidation ? `Hạ/đảo thesis khi: ${daily.invalidation}` : "Hạ thesis khi structural support bị acceptance phá vỡ.",
    risk.stance !== "approve" ? "Risk CAUTION/VETO chỉ được gỡ khi các conflict hiện tại được resolve bằng price-volume behavior." : "Nếu Council disagreement tăng mạnh, ưu tiên WAIT thay vì ép signal.",
  ]).slice(0, 4)

  const quality = inferDataQuality(snapshots)
  const latestTimestamp = snapshots.map((item) => item.barClosedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null

  return {
    ticker: rating.ticker,
    companyName: rating.companyName,
    sector: rating.sector,
    exchange: rating.exchange,
    rank: rating.rank,
    price: rating.price,
    changePct: rating.changePct,
    signal,
    signalLabel: signalLabel(signal),
    councilScore,
    confidence,
    consensus,
    consensusLabel: consensusLabel(consensus),
    bullVotes,
    neutralVotes,
    bearVotes,
    riskStatus: risk.stance as CouncilRiskStance,
    confirmationPending,
    support: daily?.support || "—",
    resistance: daily?.resistance || "—",
    confirmation: daily?.confirmation || "Break → Hold → Test → Follow-through",
    invalidation: daily?.invalidation || "Structural support failure / acceptance ngược thesis",
    dataQuality: quality.quality,
    dataQualityDetail: quality.detail,
    asOf: latestTimestamp,
    agents,
    bullCase,
    bearCase,
    dissent,
    whatChangesDecision,
  }
}
