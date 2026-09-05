import type { ResearchReportDetailClient } from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const MENTION_TABLE = "market_research_report_ticker_mentions"
const MAX_ERROR_CHARS = 500

function sanitizeErrorMessage(value: string | null | undefined): string {
  let sanitized = String(value ?? "unknown Supabase error")
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (apiKey) sanitized = sanitized.split(apiKey).join("[REDACTED]")

  return sanitized
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_ERROR_CHARS)
}

function supabaseError(prefix: string, error: { message?: string } | null): Error {
  return new Error(`${prefix}: ${sanitizeErrorMessage(error?.message)}`.slice(0, MAX_ERROR_CHARS))
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

export async function findResearchReportDetailRow(
  client: ResearchReportDetailClient,
  reportId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client
    .from(REPORT_TABLE)
    .select("id,title,source_name,publish_date,category,sector_name,link,content_hash,parsed_page_count,ingestion_status,analysis_status")
    .eq("id", reportId)
    .maybeSingle()

  if (result.error) throw supabaseError("Research report detail lookup failed", result.error)
  return result.data
}

export async function findLatestResearchReportAnalysisRow(
  client: ResearchReportDetailClient,
  reportId: string,
  contentHash: string,
): Promise<Record<string, unknown> | null> {
  const result = await client
    .from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,executive_summary,key_points,market_view,sector_outlook,catalysts,risks,confidence,model_requested,model_actual,processed_at,created_at")
    .eq("report_id", reportId)
    .eq("content_hash", contentHash)
    .order("processed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error) throw supabaseError("Research report analysis detail lookup failed", result.error)
  return result.data
}

export async function findResearchReportTickerMentionRows(
  client: ResearchReportDetailClient,
  analysisId: string,
): Promise<Record<string, unknown>[]> {
  const result = await client
    .from(MENTION_TABLE)
    .select("ticker,stance,recommendation_text,target_price,target_currency,rationale,evidence")
    .eq("analysis_id", analysisId)
    .order("ticker", { ascending: true })

  if (result.error) throw supabaseError("Research report ticker mention lookup failed", result.error)
  return Array.isArray(result.data)
    ? result.data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    : []
}

export async function findResearchReportPdfSource(
  client: ResearchReportDetailClient,
  reportId: string,
): Promise<{ id: string; title: string; pdfUrl: string } | null> {
  const result = await client
    .from(REPORT_TABLE)
    .select("id,title,pdf_url")
    .eq("id", reportId)
    .maybeSingle()

  if (result.error) throw supabaseError("Research report PDF source lookup failed", result.error)
  if (!result.data) return null

  const id = nonEmptyString(result.data.id)
  const title = nonEmptyString(result.data.title)
  const pdfUrl = nonEmptyString(result.data.pdf_url)
  if (!id || !title || !pdfUrl) return null

  return { id, title, pdfUrl }
}
