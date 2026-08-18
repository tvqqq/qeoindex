export type Bias = "Bullish" | "Neutral" | "Bearish" | "Mixed" | ""
export type MarketRegime = "Risk-On" | "Neutral" | "Risk-Off" | ""
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | ""
export type Outcome = "Pending" | "Confirmed" | "Invalidated" | "Mixed" | ""
export type ActualScenario = "Bull" | "Base" | "Bear" | "Unresolved" | ""

export interface ProbabilitySet {
  bull: number | null
  base: number | null
  bear: number | null
}

export interface PriceSnapshot {
  value: number
  changePct: number
  timestamp: string
  source: string
}

export interface Thesis {
  id: string
  notionUrl: string
  ticker: string
  company: string
  status: string
  taBias: Bias
  faBias: Bias
  wyckoffState: string
  marketRegime: MarketRegime
  baseCase: string
  probabilities: ProbabilitySet
  support: string
  resistance: string
  confirmation: string
  invalidation: string
  whatChanged: string
  confidence: Confidence
  lastAnalysis: string
  lastFAUpdate: string
  updated: string
  driveFolder: string
  price?: PriceSnapshot
}

export interface AnalysisLog {
  id: string
  notionUrl: string
  ticker: string
  analysis: string
  date: string
  timeframes: string[]
  type: string[]
  summary: string
  probabilities: ProbabilitySet
  outcome: Outcome
  actualScenario: ActualScenario
  errorClass: string
  lessonLearned: string
  taBias: Bias
  faBias: Bias
  driveEvidence: string
  sourceChat: string
  updated: string
}

export interface ResearchConnection {
  notionConfigured: boolean
  notionLive: boolean
  message: string
}

export interface ResearchStats {
  pendingReviews?: number
}

export interface ResearchPagination {
  hasMore: boolean
  nextCursor: string | null
}

export interface ResearchData {
  source: "notion"
  generatedAt: string
  connection: ResearchConnection
  theses: Thesis[]
  logs: AnalysisLog[]
  stats?: ResearchStats
  pagination?: ResearchPagination
}
