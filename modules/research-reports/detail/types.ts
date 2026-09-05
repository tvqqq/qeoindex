export type ResearchReportDetailStatus =
  | "pending"
  | "ready"
  | "needs_ocr"
  | "unsupported"
  | "failed"

export interface ResearchReportDetailCitation {
  page: number
  snippet: string
}

export interface ResearchReportDetailTickerMention {
  ticker: string
  stance: "positive" | "negative" | "neutral" | "mixed"
  recommendationText: string | null
  targetPrice: number | null
  targetCurrency: string | null
  rationale: string | null
  evidence: ResearchReportDetailCitation[]
}

export interface ResearchReportDetailAnalysis {
  analysisId: string
  executiveSummary: string
  keyPoints: string[]
  marketView: string | null
  sectorOutlook: string | null
  catalysts: string[]
  risks: string[]
  processedAt: string
  model: string
  confidence: { score: number; flags: string[] }
  tickerMentions: ResearchReportDetailTickerMention[]
}

export interface ResearchReportDetailViewModel {
  id: string
  title: string
  sourceName: string
  publishDate: string
  category: "macro" | "strategy" | "sector" | "other"
  sectorName: string | null
  originalSourceLink: string | null
  parsedPageCount: number
  ingestionStatus: string
  analysisStatus: ResearchReportDetailStatus
  analysis: ResearchReportDetailAnalysis | null
}

export type ResearchReportDetailResolution =
  | { status: "found"; report: ResearchReportDetailViewModel }
  | { status: "not_found" }
  | { status: "invalid_id" }

export interface ResearchReportDetailQuery
  extends PromiseLike<{
    data: Record<string, unknown>[] | Record<string, unknown> | null
    error: { message?: string } | null
  }> {
  select(columns: string): ResearchReportDetailQuery
  eq(column: string, value: unknown): ResearchReportDetailQuery
  order(column: string, options?: { ascending?: boolean }): ResearchReportDetailQuery
  limit(value: number): ResearchReportDetailQuery
  maybeSingle(): PromiseLike<{
    data: Record<string, unknown> | null
    error: { message?: string } | null
  }>
}

export interface ResearchReportDetailClient {
  from(table: string): ResearchReportDetailQuery
}
