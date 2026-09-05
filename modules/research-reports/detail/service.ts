import { safeResearchReportPdfBrowserUrl } from "./pdf-route.ts"
import {
  findLatestResearchReportAnalysisRow,
  findResearchReportDetailRow,
  findResearchReportTickerMentionRows,
} from "./repository.ts"
import type {
  ResearchReportDetailAnalysis,
  ResearchReportDetailCitation,
  ResearchReportDetailClient,
  ResearchReportDetailResolution,
  ResearchReportDetailStatus,
  ResearchReportDetailTickerMention,
  ResearchReportDetailViewModel,
} from "./types.ts"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTENT_HASH_RE = /^[a-f0-9]{64}$/i
const TICKER_RE = /^[A-Z0-9]{2,12}$/
const CATEGORIES = new Set(["macro", "strategy", "sector", "other"])
const STANCES = new Set(["positive", "negative", "neutral", "mixed"])

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function nullableString(value: unknown): string | null {
  return nonEmptyString(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(nonEmptyString)
    .filter((item): item is string => item !== null)
}

function category(value: unknown): ResearchReportDetailViewModel["category"] {
  const normalized = nonEmptyString(value)?.toLowerCase()
  return normalized && CATEGORIES.has(normalized)
    ? normalized as ResearchReportDetailViewModel["category"]
    : "other"
}

function detailStatus(value: unknown): ResearchReportDetailStatus {
  switch (nonEmptyString(value)?.toLowerCase()) {
    case "ready":
      return "ready"
    case "needs_ocr":
      return "needs_ocr"
    case "unsupported":
      return "unsupported"
    case "failed":
      return "failed"
    case "pending":
    case "processing":
    default:
      return "pending"
  }
}

function parsedPageCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function safeHttpsLink(value: unknown): string | null {
  const raw = nonEmptyString(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function confidence(value: unknown): { score: number; flags: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { score: 0, flags: [] }
  }

  const row = value as Record<string, unknown>
  const score = typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0 && row.score <= 100
    ? row.score
    : 0
  return { score, flags: stringArray(row.flags) }
}

function positiveNumber(value: unknown): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function citationEvidence(value: unknown, pageCount: number): ResearchReportDetailCitation[] {
  if (!Array.isArray(value) || pageCount <= 0) return []
  const citations: ResearchReportDetailCitation[] = []

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const page = row.page
    const snippet = nonEmptyString(row.snippet)
    if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > pageCount || !snippet) continue
    citations.push({ page: Number(page), snippet })
  }

  return citations
}

function tickerMention(
  row: Record<string, unknown>,
  pageCount: number,
): ResearchReportDetailTickerMention | null {
  const ticker = nonEmptyString(row.ticker)?.toUpperCase() ?? ""
  const stance = nonEmptyString(row.stance)?.toLowerCase() ?? ""
  if (!TICKER_RE.test(ticker) || !STANCES.has(stance)) return null

  const targetPrice = positiveNumber(row.target_price)
  const targetCurrency = targetPrice === null
    ? null
    : nonEmptyString(row.target_currency)?.toUpperCase() ?? null

  return {
    ticker,
    stance: stance as ResearchReportDetailTickerMention["stance"],
    recommendationText: nullableString(row.recommendation_text),
    targetPrice,
    targetCurrency,
    rationale: nullableString(row.rationale),
    evidence: citationEvidence(row.evidence, pageCount),
  }
}

function baseReportViewModel(row: Record<string, unknown>): ResearchReportDetailViewModel {
  return {
    id: nonEmptyString(row.id) ?? "",
    title: nonEmptyString(row.title) ?? "Báo cáo nghiên cứu",
    sourceName: nonEmptyString(row.source_name) ?? "Nguồn báo cáo",
    publishDate: nonEmptyString(row.publish_date) ?? "",
    category: category(row.category),
    sectorName: nullableString(row.sector_name),
    originalSourceLink: safeHttpsLink(row.link),
    originalPdfUrl: safeResearchReportPdfBrowserUrl(row.pdf_url),
    parsedPageCount: parsedPageCount(row.parsed_page_count),
    ingestionStatus: nonEmptyString(row.ingestion_status) ?? "discovered",
    analysisStatus: detailStatus(row.analysis_status),
    analysis: null,
  }
}

function analysisViewModel(
  row: Record<string, unknown>,
  mentions: readonly Record<string, unknown>[],
  pageCount: number,
): ResearchReportDetailAnalysis | null {
  const analysisId = nonEmptyString(row.id)
  const processedAt = nonEmptyString(row.processed_at)
  const model = nonEmptyString(row.model_actual) ?? nonEmptyString(row.model_requested)
  if (!analysisId || !processedAt || !model) return null

  return {
    analysisId,
    executiveSummary: nonEmptyString(row.executive_summary) ?? "",
    keyPoints: stringArray(row.key_points),
    marketView: nullableString(row.market_view),
    sectorOutlook: nullableString(row.sector_outlook),
    catalysts: stringArray(row.catalysts),
    risks: stringArray(row.risks),
    processedAt,
    model,
    confidence: confidence(row.confidence),
    tickerMentions: mentions
      .map((mention) => tickerMention(mention, pageCount))
      .filter((mention): mention is ResearchReportDetailTickerMention => mention !== null),
  }
}

export async function getResearchReportDetail(
  client: ResearchReportDetailClient,
  reportId: string,
): Promise<ResearchReportDetailResolution> {
  if (!UUID_RE.test(reportId)) return { status: "invalid_id" }

  const reportRow = await findResearchReportDetailRow(client, reportId)
  if (!reportRow) return { status: "not_found" }

  const report = baseReportViewModel(reportRow)
  if (report.analysisStatus !== "ready") return { status: "found", report }

  const contentHash = nonEmptyString(reportRow.content_hash)
  if (!contentHash || !CONTENT_HASH_RE.test(contentHash)) {
    return { status: "found", report: { ...report, analysisStatus: "pending" } }
  }

  const analysisRow = await findLatestResearchReportAnalysisRow(client, reportId, contentHash)
  if (!analysisRow) {
    return { status: "found", report: { ...report, analysisStatus: "pending" } }
  }

  const analysisId = nonEmptyString(analysisRow.id)
  if (!analysisId) {
    return { status: "found", report: { ...report, analysisStatus: "pending" } }
  }

  const mentionRows = await findResearchReportTickerMentionRows(client, analysisId)
  const analysis = analysisViewModel(analysisRow, mentionRows, report.parsedPageCount)
  if (!analysis) {
    return { status: "found", report: { ...report, analysisStatus: "pending" } }
  }

  return {
    status: "found",
    report: {
      ...report,
      analysisStatus: "ready",
      analysis,
    },
  }
}
