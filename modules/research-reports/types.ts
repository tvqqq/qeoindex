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
