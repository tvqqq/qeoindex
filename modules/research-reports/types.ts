export const RESEARCH_REPORT_CATEGORIES = ["macro", "strategy", "sector", "other"] as const

export type ResearchReportCategory = (typeof RESEARCH_REPORT_CATEGORIES)[number]
export type ResearchReportProvider = "topi"

export interface ResearchReportSourceRecord {
  provider: ResearchReportProvider
  externalReportId: string
  title: string
  sourceName: string
  publishDate: string
  originalTypeReport: string | null
  category: ResearchReportCategory
  sectorName: string | null
  recommendation: string | null
  targetPrice: number | null
  code: string | null
  link: string | null
  pdfUrl: string
  sourcePayload: Record<string, unknown>
}

export interface ResearchReportDiscoveryResult {
  reports: ResearchReportSourceRecord[]
  pagesFetched: number
  stoppedAtKnownBoundary: boolean
}

export interface ResearchReportUpsertResult {
  upserted: number
}

export interface ParsedReportPage {
  pageNumber: number
  text: string
}

export type PdfTextStatus = "parsed" | "needs_ocr" | "unsupported"

export interface ParsedResearchReportPdf {
  status: PdfTextStatus
  pages: ParsedReportPage[]
  pageCount: number
}

export interface ResearchReportChunk {
  pageNumber: number
  chunkIndex: number
  content: string
  chunkHash: string
  chunkVersion: string
}

export type ResearchReportTickerStance = "positive" | "negative" | "neutral" | "mixed"

export interface ResearchReportEvidenceRef {
  page: number
  snippet: string
}

export interface StructuredResearchReportTickerMention {
  ticker: string
  stance: ResearchReportTickerStance
  recommendationText: string | null
  targetPrice: number | null
  targetCurrency: string | null
  rationale: string
  evidence: ResearchReportEvidenceRef[]
}

export interface StructuredResearchReportAnalysis {
  executiveSummary: string
  keyPoints: string[]
  marketView: string | null
  sectorOutlook: string | null
  catalysts: string[]
  risks: string[]
  tickerMentions: StructuredResearchReportTickerMention[]
  confidence: {
    score: number
    flags: string[]
  }
}

export interface ProcessResearchReportResult {
  reportId: string
  status: "ready" | "needs_ocr" | "unsupported" | "failed" | "skipped_existing"
  contentHash: string | null
  analysisId: string | null
  aiCalled: boolean
  detail: string
}
