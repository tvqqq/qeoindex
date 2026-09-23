import { generateResearchReportSummaryImage } from "./summary-image.ts"
import type { ResearchReportWorkflowCandidate } from "./daily/orchestrator.ts"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const DEFAULT_MAX_REPORTS = 20
const HARD_MAX_REPORTS = 100
const PAGE_SIZE = 200
const MAX_SCAN_REPORTS = 5_000

export interface ResearchReportSummaryImageBackfillCandidate extends ResearchReportWorkflowCandidate {
  analysisId: string
  contentHash: string
}

export interface ResearchReportSummaryImageBackfillPrepared {
  scanned: number
  selected: ResearchReportSummaryImageBackfillCandidate[]
  skippedReadyCurrent: number
  skippedGenerating: number
  missingCurrentAnalysis: number
  hasMore: boolean
}

export interface ResearchReportSummaryImageBackfillStepResult {
  candidate: ResearchReportSummaryImageBackfillCandidate
  status: "ready" | "skipped_existing" | "failed"
  path: string | null
  detail: string
  startedAt: string
  finishedAt: string
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized || null
}

function epoch(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizedProvider(value: unknown): "topi" | null {
  return value === "topi" ? "topi" : null
}

export function normalizeResearchReportSummaryImageBackfillMaxReports(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_MAX_REPORTS
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > HARD_MAX_REPORTS) {
    throw new Error(`maxReports must be an integer from 1 to ${HARD_MAX_REPORTS}`)
  }
  return numeric
}

export function selectResearchReportSummaryImageBackfillCandidates(
  reportRows: readonly Record<string, unknown>[],
  analysisRows: readonly Record<string, unknown>[],
  maxReports: number,
): ResearchReportSummaryImageBackfillPrepared {
  const limit = normalizeResearchReportSummaryImageBackfillMaxReports(maxReports)
  const analysesByReport = new Map<string, Record<string, unknown>[]>()

  for (const analysis of analysisRows) {
    const reportId = nonEmptyString(analysis.report_id)
    if (!reportId) continue
    const list = analysesByReport.get(reportId) ?? []
    list.push(analysis)
    analysesByReport.set(reportId, list)
  }

  for (const list of analysesByReport.values()) {
    list.sort((left, right) => {
      const processedDiff = epoch(right.processed_at) - epoch(left.processed_at)
      if (processedDiff !== 0) return processedDiff
      return epoch(right.created_at) - epoch(left.created_at)
    })
  }

  const orderedReports = [...reportRows].sort((left, right) => {
    const dateDiff = epoch(right.publish_date) - epoch(left.publish_date)
    if (dateDiff !== 0) return dateDiff
    return String(left.id ?? "").localeCompare(String(right.id ?? ""))
  })

  const selected: ResearchReportSummaryImageBackfillCandidate[] = []
  let skippedReadyCurrent = 0
  let skippedGenerating = 0
  let missingCurrentAnalysis = 0
  let eligibleCount = 0

  for (const report of orderedReports) {
    const reportId = nonEmptyString(report.id)
    const contentHash = nonEmptyString(report.content_hash)
    const provider = normalizedProvider(report.provider)
    const externalReportId = nonEmptyString(report.external_report_id)
    const publishDate = nonEmptyString(report.publish_date)
    const pdfUrl = nonEmptyString(report.pdf_url)

    if (
      !reportId
      || report.analysis_status !== "ready"
      || !contentHash
      || !provider
      || !externalReportId
      || !publishDate
      || !pdfUrl
    ) {
      missingCurrentAnalysis += 1
      continue
    }

    const currentAnalysis = (analysesByReport.get(reportId) ?? [])
      .find((analysis) => nonEmptyString(analysis.content_hash) === contentHash)
    const analysisId = currentAnalysis ? nonEmptyString(currentAnalysis.id) : null

    if (!analysisId) {
      missingCurrentAnalysis += 1
      continue
    }

    if (report.summary_image_status === "generating") {
      skippedGenerating += 1
      continue
    }

    const currentReady = report.summary_image_status === "ready"
      && Boolean(nonEmptyString(report.summary_image_path))
      && nonEmptyString(report.summary_image_analysis_id) === analysisId

    if (currentReady) {
      skippedReadyCurrent += 1
      continue
    }

    eligibleCount += 1
    if (selected.length >= limit) continue

    selected.push({
      id: reportId,
      provider,
      externalReportId,
      publishDate,
      pdfUrl,
      analysisId,
      contentHash,
    })
  }

  return {
    scanned: orderedReports.length,
    selected,
    skippedReadyCurrent,
    skippedGenerating,
    missingCurrentAnalysis,
    hasMore: eligibleCount > selected.length,
  }
}

export async function prepareResearchReportSummaryImageBackfillStep(input: {
  maxReports?: number
}): Promise<ResearchReportSummaryImageBackfillPrepared> {
  "use step"

  const maxReports = normalizeResearchReportSummaryImageBackfillMaxReports(input.maxReports)
  const { getSupabaseServerClient } = await import("../shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured for Research Report image backfill")

  const selected: ResearchReportSummaryImageBackfillCandidate[] = []
  let scanned = 0
  let skippedReadyCurrent = 0
  let skippedGenerating = 0
  let missingCurrentAnalysis = 0
  let hasMore = false

  for (let offset = 0; offset < MAX_SCAN_REPORTS && selected.length < maxReports; offset += PAGE_SIZE) {
    const { data: reports, error: reportError } = await supabase
      .from(REPORT_TABLE)
      .select("id,provider,external_report_id,publish_date,pdf_url,content_hash,analysis_status,summary_image_status,summary_image_path,summary_image_analysis_id")
      .eq("analysis_status", "ready")
      .not("content_hash", "is", null)
      .order("publish_date", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (reportError) throw new Error(`Research Report image backfill candidate lookup failed: ${reportError.message}`)
    const reportRows = Array.isArray(reports) ? reports : []
    if (reportRows.length === 0) break

    const reportIds = reportRows
      .map((row) => nonEmptyString(row.id))
      .filter((value): value is string => Boolean(value))

    const { data: analyses, error: analysisError } = reportIds.length > 0
      ? await supabase
          .from(ANALYSIS_TABLE)
          .select("id,report_id,content_hash,processed_at,created_at")
          .in("report_id", reportIds)
      : { data: [], error: null }

    if (analysisError) throw new Error(`Research Report image backfill analysis lookup failed: ${analysisError.message}`)

    const remaining = maxReports - selected.length
    const prepared = selectResearchReportSummaryImageBackfillCandidates(
      reportRows as Record<string, unknown>[],
      (Array.isArray(analyses) ? analyses : []) as Record<string, unknown>[],
      remaining,
    )

    scanned += prepared.scanned
    skippedReadyCurrent += prepared.skippedReadyCurrent
    skippedGenerating += prepared.skippedGenerating
    missingCurrentAnalysis += prepared.missingCurrentAnalysis
    selected.push(...prepared.selected)

    if (prepared.hasMore) {
      hasMore = true
      break
    }
    if (selected.length >= maxReports) {
      hasMore = reportRows.length === PAGE_SIZE
      break
    }
    if (reportRows.length < PAGE_SIZE) break
  }

  if (scanned >= MAX_SCAN_REPORTS && selected.length >= maxReports) hasMore = true

  return {
    scanned,
    selected,
    skippedReadyCurrent,
    skippedGenerating,
    missingCurrentAnalysis,
    hasMore,
  }
}

export async function generateResearchReportSummaryImageBackfillStep(
  candidate: ResearchReportSummaryImageBackfillCandidate,
): Promise<ResearchReportSummaryImageBackfillStepResult> {
  "use step"

  const startedAt = new Date().toISOString()
  const { getSupabaseServerClient } = await import("../shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured for Research Report image backfill")

  const result = await generateResearchReportSummaryImage(
    supabase as unknown as Parameters<typeof generateResearchReportSummaryImage>[0],
    { reportId: candidate.id, analysisId: candidate.analysisId },
  )

  return {
    candidate,
    status: result.status,
    path: result.path,
    detail: result.detail,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}
