import type {
  ResearchReportChunk,
  ResearchReportSourceRecord,
  ResearchReportUpsertResult,
  StructuredResearchReportAnalysis,
} from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const REPORT_CONFLICT_TARGET = "provider,external_report_id"
const PUBLISH_RPC = "qeo_publish_research_report_analysis"
const ACQUIRE_LEASE_RPC = "qeo_acquire_research_report_analysis_lease"
const RELEASE_LEASE_RPC = "qeo_release_research_report_analysis_lease"
const MAX_PERSISTED_ERROR_CHARS = 800

interface ResearchReportUpsertClient {
  from(table: string): {
    upsert(
      rows: Array<Record<string, unknown>>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): PromiseLike<{ error: { message?: string } | null }>
  }
}

interface AnalysisLookupRow {
  id: string
  report_id: string
  content_hash: string
  analysis_version: string
  prompt_version: string
  model_route_key: string
}

interface AnalysisLookupBuilder {
  select(columns: string): AnalysisLookupBuilder
  eq(column: string, value: unknown): AnalysisLookupBuilder
  maybeSingle(): PromiseLike<{
    data: AnalysisLookupRow | null
    error: { message?: string } | null
  }>
}

interface AnalysisLookupClient {
  from(table: string): AnalysisLookupBuilder
}

interface ReportStatusClient {
  from(table: string): {
    update(patch: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: { message?: string } | null }>
    }
  }
}

interface ReportPublishClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface ResearchReportLeaseClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

export interface ResearchReportAnalysisIdentity {
  reportId: string
  contentHash: string
  analysisVersion: string
  promptVersion: string
  modelRouteKey: string
}

export interface ExistingResearchReportAnalysis extends ResearchReportAnalysisIdentity {
  id: string
}

export type ResearchReportAnalysisLeaseResult =
  | { outcome: "acquired"; leaseToken: string; expiresAt: string }
  | { outcome: "existing_success"; analysisId: string }
  | { outcome: "busy"; expiresAt: string }

export type ResearchReportIngestionStatus =
  | "discovered"
  | "fetching"
  | "parsed"
  | "needs_ocr"
  | "failed"
  | "unsupported"

export type ResearchReportAnalysisStatus =
  | "pending"
  | "processing"
  | "ready"
  | "needs_ocr"
  | "failed"
  | "unsupported"

export interface ResearchReportStatusPatch {
  contentHash?: string | null
  parsedPageCount?: number
  ingestionStatus?: ResearchReportIngestionStatus
  ingestionError?: string | null
  analysisStatus?: ResearchReportAnalysisStatus
  analysisError?: string | null
}

export interface ResearchReportPublishPayload {
  identity: ResearchReportAnalysisIdentity
  reasoningEffort: string
  chunkVersion: string
  parsedPageCount: number
  modelRequested: string
  modelActual: string
  responseId: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  latencyMs: number
  estimatedCostUsd: number | null
  pricingVersion: string | null
  analysis: StructuredResearchReportAnalysis
  chunks: ResearchReportChunk[]
}

function sanitizePersistedError(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null

  let sanitized = value
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (apiKey) sanitized = sanitized.split(apiKey).join("[REDACTED]")

  sanitized = sanitized
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()

  return sanitized.slice(0, MAX_PERSISTED_ERROR_CHARS)
}

function supabaseError(prefix: string, error: { message?: string } | null): Error {
  const detail = sanitizePersistedError(error?.message) || "unknown Supabase error"
  return new Error(`${prefix}: ${detail}`.slice(0, MAX_PERSISTED_ERROR_CHARS))
}

function firstRpcRow(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const value = data[0]
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null
}

export function toResearchReportUpsertRow(report: ResearchReportSourceRecord): Record<string, unknown> {
  return {
    provider: report.provider,
    external_report_id: report.externalReportId,
    title: report.title,
    source_name: report.sourceName,
    publish_date: report.publishDate,
    original_type_report: report.originalTypeReport,
    category: report.category,
    sector_name: report.sectorName,
    recommendation: report.recommendation,
    target_price: report.targetPrice,
    code: report.code,
    link: report.link,
    pdf_url: report.pdfUrl,
    source_payload: report.sourcePayload,
    updated_at: new Date().toISOString(),
  }
}

export async function upsertResearchReports(
  client: ResearchReportUpsertClient,
  reports: readonly ResearchReportSourceRecord[],
): Promise<ResearchReportUpsertResult> {
  if (reports.length === 0) return { upserted: 0 }

  const rows = reports.map(toResearchReportUpsertRow)
  const result = await client.from(REPORT_TABLE).upsert(rows, {
    onConflict: REPORT_CONFLICT_TARGET,
    ignoreDuplicates: false,
  })

  if (result.error) {
    throw supabaseError("Research report metadata upsert failed", result.error)
  }

  return { upserted: rows.length }
}

export async function findSuccessfulResearchReportAnalysis(
  client: AnalysisLookupClient,
  identity: ResearchReportAnalysisIdentity,
): Promise<ExistingResearchReportAnalysis | null> {
  const result = await client
    .from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,analysis_version,prompt_version,model_route_key")
    .eq("report_id", identity.reportId)
    .eq("content_hash", identity.contentHash)
    .eq("analysis_version", identity.analysisVersion)
    .eq("prompt_version", identity.promptVersion)
    .eq("model_route_key", identity.modelRouteKey)
    .maybeSingle()

  if (result.error) throw supabaseError("Research report analysis lookup failed", result.error)
  if (!result.data) return null

  return {
    id: result.data.id,
    reportId: result.data.report_id,
    contentHash: result.data.content_hash,
    analysisVersion: result.data.analysis_version,
    promptVersion: result.data.prompt_version,
    modelRouteKey: result.data.model_route_key,
  }
}

export async function acquireResearchReportAnalysisLease(
  client: ResearchReportLeaseClient,
  input: ResearchReportAnalysisIdentity & { runId: string; ttlSeconds?: number },
): Promise<ResearchReportAnalysisLeaseResult> {
  const result = await client.rpc(ACQUIRE_LEASE_RPC, {
    p_report_id: input.reportId,
    p_content_hash: input.contentHash,
    p_analysis_version: input.analysisVersion,
    p_prompt_version: input.promptVersion,
    p_model_route_key: input.modelRouteKey,
    p_run_id: input.runId,
    p_ttl_seconds: input.ttlSeconds ?? 900,
  })
  if (result.error) throw supabaseError("Research report analysis lease acquisition failed", result.error)

  const row = firstRpcRow(result.data)
  const outcome = row?.outcome
  if (outcome === "acquired") {
    const leaseToken = row?.lease_token
    const expiresAt = row?.expires_at
    if (typeof leaseToken !== "string" || typeof expiresAt !== "string") {
      throw new Error("Research report analysis lease acquisition failed: malformed acquired lease")
    }
    return { outcome, leaseToken, expiresAt }
  }
  if (outcome === "existing_success") {
    const analysisId = row?.analysis_id
    if (typeof analysisId !== "string" || !analysisId) {
      throw new Error("Research report analysis lease acquisition failed: malformed existing analysis")
    }
    return { outcome, analysisId }
  }
  if (outcome === "busy") {
    const expiresAt = row?.expires_at
    if (typeof expiresAt !== "string") {
      throw new Error("Research report analysis lease acquisition failed: malformed busy lease")
    }
    return { outcome, expiresAt }
  }
  throw new Error("Research report analysis lease acquisition failed: unknown outcome")
}

export async function releaseResearchReportAnalysisLease(
  client: ResearchReportLeaseClient,
  input: { leaseToken: string; terminalOutcome: "ready" | "failed" },
): Promise<void> {
  const result = await client.rpc(RELEASE_LEASE_RPC, {
    p_lease_token: input.leaseToken,
    p_terminal_outcome: input.terminalOutcome,
  })
  if (result.error) throw supabaseError("Research report analysis lease release failed", result.error)
  if (result.data !== true) {
    throw new Error("Research report analysis lease release failed: lease token was not owned")
  }
}

export async function markResearchReportStatus(
  client: ReportStatusClient,
  reportId: string,
  patch: ResearchReportStatusPatch,
): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if ("contentHash" in patch) row.content_hash = patch.contentHash ?? null
  if ("parsedPageCount" in patch) row.parsed_page_count = patch.parsedPageCount
  if ("ingestionStatus" in patch) row.ingestion_status = patch.ingestionStatus
  if ("ingestionError" in patch) row.ingestion_error = sanitizePersistedError(patch.ingestionError)
  if ("analysisStatus" in patch) row.analysis_status = patch.analysisStatus
  if ("analysisError" in patch) row.analysis_error = sanitizePersistedError(patch.analysisError)

  const result = await client.from(REPORT_TABLE).update(row).eq("id", reportId)
  if (result.error) throw supabaseError("Research report status update failed", result.error)
}

function serializedAnalysis(payload: ResearchReportPublishPayload): Record<string, unknown> {
  return {
    analysis_version: payload.identity.analysisVersion,
    prompt_version: payload.identity.promptVersion,
    model_route_key: payload.identity.modelRouteKey,
    reasoning_effort: payload.reasoningEffort,
    chunk_version: payload.chunkVersion,
    parsed_page_count: payload.parsedPageCount,
    model_requested: payload.modelRequested,
    model_actual: payload.modelActual,
    executive_summary: payload.analysis.executiveSummary,
    key_points: payload.analysis.keyPoints,
    market_view: payload.analysis.marketView,
    sector_outlook: payload.analysis.sectorOutlook,
    catalysts: payload.analysis.catalysts,
    risks: payload.analysis.risks,
    confidence: payload.analysis.confidence,
    response_id: payload.responseId,
    input_tokens: payload.inputTokens,
    cached_input_tokens: payload.cachedInputTokens,
    cache_write_tokens: payload.cacheWriteTokens,
    output_tokens: payload.outputTokens,
    reasoning_tokens: payload.reasoningTokens,
    total_tokens: payload.totalTokens,
    latency_ms: payload.latencyMs,
    estimated_cost_usd: payload.estimatedCostUsd,
    pricing_version: payload.pricingVersion,
  }
}

function serializedChunks(chunks: readonly ResearchReportChunk[]) {
  return chunks.map((chunk) => ({
    page_number: chunk.pageNumber,
    chunk_index: chunk.chunkIndex,
    content: chunk.content,
    chunk_hash: chunk.chunkHash,
    chunk_version: chunk.chunkVersion,
  }))
}

function serializedMentions(analysis: StructuredResearchReportAnalysis) {
  return analysis.tickerMentions.map((mention) => ({
    ticker: mention.ticker,
    stance: mention.stance,
    recommendation_text: mention.recommendationText,
    target_price: mention.targetPrice,
    target_currency: mention.targetCurrency,
    target_source: "report_extracted",
    rationale: mention.rationale,
    evidence: mention.evidence,
  }))
}

export async function publishResearchReportAnalysis(
  client: ReportPublishClient,
  payload: ResearchReportPublishPayload,
): Promise<{ analysisId: string }> {
  const result = await client.rpc(PUBLISH_RPC, {
    p_report_id: payload.identity.reportId,
    p_content_hash: payload.identity.contentHash,
    p_analysis: serializedAnalysis(payload),
    p_chunks: serializedChunks(payload.chunks),
    p_mentions: serializedMentions(payload.analysis),
  })

  if (result.error) throw supabaseError("Research report atomic publish failed", result.error)
  if (typeof result.data !== "string" || !result.data.trim()) {
    throw new Error("Research report atomic publish failed: missing analysis id")
  }

  return { analysisId: result.data }
}
