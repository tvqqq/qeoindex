import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  aiCouncilLlmModelRouteLabel,
  getAiCouncilLlmModelRoute,
  type AiCouncilLlmDebateRecord,
  type CouncilLlmModelRoute,
  type DebateSelectionReason,
  type LlmBullBearPayload,
  type LlmChairPayload,
  type LlmRiskPayload,
} from "@/modules/ai-council/llm"
import { resolveAiCouncilPromptIdentityHash } from "@/modules/ai-council/prompt-identity"
import { AI_COUNCIL_EVIDENCE_PACKET_VERSION } from "@/modules/ai-council/prompt-evidence"
import { INSIGHTS_METRIC_GUIDE_VERSION } from "@/modules/research/insights/metric-semantics"

interface DebateRow {
  run_id: string
  ticker: string
  as_of_date: string
  selection_reasons: unknown
  status: string
  model: string
  model_route: unknown
  prompt_version: string
  evidence_hash: string
  deterministic_signal: string
  deterministic_score: number
  deterministic_risk_status: string
  bull_payload: unknown
  bear_payload: unknown
  risk_payload: unknown
  chair_payload: unknown
  call_audit: unknown
  input_tokens: number
  cached_input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_tokens: number
  latency_ms: number
  estimated_cost_usd: number | string | null
  escalated: boolean
  escalation_reason: string
  fallback_used: boolean
  error: string
  created_at: string
  completed_at: string | null
}

interface RawEvidenceAuditRow {
  run_id: string
  context_version: string
  context_hash: string
  captured_at: string
}

interface ResearchContextAuditRow {
  run_id: string
  context_version: string
  context_hash: string
  raw_context_hash: string
  prompt_identity_hash: string
  mode: string
  status: string
  source_page_ids: unknown
  captured_at: string
}

type ReportSnapshotStatus = "ready" | "empty" | "unavailable"

interface ReportEvidenceSnapshotRow {
  run_id: string
  context_version: string
  context_hash: string
  status: ReportSnapshotStatus
  context_payload: unknown
  report_ids: unknown
  analysis_ids: unknown
  captured_at: string
}

type SnapshotReadClient = {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: string[]): Promise<{
        data: unknown[] | null
        error: { message?: string } | null
      }>
    }
  }
}

export interface AiCouncilRelatedReport {
  reportId: string
  title: string
  sourceName: string
  publishDate: string
  category: string
  tickerStance: string | null
}

export interface AiCouncilDebateDashboardProvenance {
  packetVersion: string
  semanticGuideVersion: string
  deterministicEvidenceHash: string
  rawContextVersion: string | null
  rawContextHash: string | null
  rawCapturedAt: string | null
  researchContextVersion: string | null
  researchContextHash: string | null
  researchStatus: string | null
  researchMode: string | null
  researchSourceCount: number
  researchCapturedAt: string | null
  reportContextVersion: string | null
  reportContextHash: string | null
  reportStatus: ReportSnapshotStatus | null
  reportCount: number
  reportCapturedAt: string | null
  promptIdentityHash: string
  cacheIdentityMode: "prompt-identity-v2-report-evidence" | "prompt-identity-v1" | "legacy-evidence-hash"
}

export interface AiCouncilDebateDashboardRow extends Omit<AiCouncilLlmDebateRecord, "evidenceProvenance"> {
  evidenceProvenance?: AiCouncilDebateDashboardProvenance
  relatedReports: AiCouncilRelatedReport[]
}

export interface AiCouncilDebateDashboardData {
  generatedAt: string
  latestDate: string | null
  enabledByConfiguration: boolean
  model: string
  modelRoute: CouncilLlmModelRoute
  rows: AiCouncilDebateDashboardRow[]
  completed: number
  partial: number
  failed: number
  escalated: number
  fallbackUsed: number
  totalTokens: number
  cachedInputTokens: number
  estimatedCostUsd: number | null
  message: string
}

function snapshotDb(client: SupabaseClient) {
  return client as unknown as SnapshotReadClient
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function validHash(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null
}

function debateReasons(value: unknown): DebateSelectionReason[] {
  const allowed = new Set<DebateSelectionReason>(["explicit_watchlist", "signal_changed", "high_disagreement", "breakout_watch", "risk_conflict"])
  return Array.isArray(value) ? value.filter((item): item is DebateSelectionReason => typeof item === "string" && allowed.has(item as DebateSelectionReason)) : []
}

function bullBear(value: unknown): LlmBullBearPayload | null {
  const item = record(value)
  return typeof item.thesis === "string" ? item as unknown as LlmBullBearPayload : null
}

function risk(value: unknown): LlmRiskPayload | null {
  const item = record(value)
  return typeof item.riskSummary === "string" ? item as unknown as LlmRiskPayload : null
}

function chair(value: unknown): LlmChairPayload | null {
  const item = record(value)
  return typeof item.summary === "string" ? item as unknown as LlmChairPayload : null
}

function modelRoute(value: unknown): CouncilLlmModelRoute | null {
  const item = record(value)
  return record(item.bull).model && record(item.risk).model && record(item.chair).model
    ? item as unknown as CouncilLlmModelRoute
    : null
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function reportSnapshotStatus(value: unknown): ReportSnapshotStatus | null {
  return value === "ready" || value === "empty" || value === "unavailable" ? value : null
}

function relatedReports(snapshot: ReportEvidenceSnapshotRow | undefined, ticker: string): AiCouncilRelatedReport[] {
  if (!snapshot || snapshot.status !== "ready") return []
  const reports = record(snapshot.context_payload).reports
  if (!Array.isArray(reports)) return []

  const normalized: AiCouncilRelatedReport[] = []
  for (const value of reports.slice(0, 5)) {
    const report = record(value)
    const reportId = text(report.reportId)
    const title = text(report.title)
    if (!reportId || !title) continue

    const tickerMention = record(report.tickerMention)
    const matchedTicker = text(tickerMention.ticker).toUpperCase() === ticker.toUpperCase()
      ? tickerMention
      : null

    normalized.push({
      reportId,
      title,
      sourceName: text(report.sourceName) || "Research provider",
      publishDate: text(report.publishDate),
      category: text(report.category) || "research",
      tickerStance: matchedTicker ? text(matchedTicker.stance) || null : null,
    })
  }
  return normalized
}

function normalize(
  row: DebateRow,
  rawEvidence: RawEvidenceAuditRow | undefined,
  researchContext: ResearchContextAuditRow | undefined,
  reportSnapshot: ReportEvidenceSnapshotRow | undefined,
): AiCouncilDebateDashboardRow {
  const status = row.status === "completed" || row.status === "partial" || row.status === "failed" ? row.status : "pending"
  const reportEvidenceContext = row.prompt_version === "llm-debate-v4-research-report-evidence"
  const firstClassContext = reportEvidenceContext || row.prompt_version === "llm-debate-v3-first-class-context"
  const semanticPacket = firstClassContext || row.prompt_version === "llm-debate-v2-semantic-grounding"
  const reportStatus = reportSnapshotStatus(reportSnapshot?.status)
  const reportContextHash = validHash(reportSnapshot?.context_hash)
  const reportParticipatesInPrompt = reportEvidenceContext
    && (reportStatus === "ready" || reportStatus === "empty")
    && Boolean(reportContextHash)

  const promptIdentityHash = firstClassContext
    ? resolveAiCouncilPromptIdentityHash({
        evidenceHash: row.evidence_hash,
        ...(rawEvidence ? { llmEvidence: { contextHash: rawEvidence.context_hash } } : {}),
        ...(researchContext ? {
          researchContext: {
            contextHash: researchContext.context_hash,
            promptIdentityHash: researchContext.prompt_identity_hash,
          },
        } : {}),
        ...(reportParticipatesInPrompt && reportContextHash ? {
          reportEvidence: { contextHash: reportContextHash },
        } : {}),
      }, row.prompt_version)
    : row.evidence_hash
  const sourcePageIds = Array.isArray(researchContext?.source_page_ids) ? researchContext.source_page_ids : []
  const frozenReports = relatedReports(reportSnapshot, row.ticker)
  const reportIds = stringArray(reportSnapshot?.report_ids)

  return {
    id: row.run_id,
    runId: row.run_id,
    ticker: row.ticker,
    asOfDate: row.as_of_date,
    evidenceHash: row.evidence_hash,
    evidenceProvenance: {
      packetVersion: semanticPacket ? AI_COUNCIL_EVIDENCE_PACKET_VERSION : "legacy-council-packet",
      semanticGuideVersion: semanticPacket ? INSIGHTS_METRIC_GUIDE_VERSION : "legacy",
      deterministicEvidenceHash: row.evidence_hash,
      rawContextVersion: rawEvidence?.context_version || null,
      rawContextHash: rawEvidence?.context_hash || null,
      rawCapturedAt: rawEvidence?.captured_at || null,
      researchContextVersion: researchContext?.context_version || null,
      researchContextHash: researchContext?.context_hash || null,
      researchStatus: researchContext?.status || null,
      researchMode: researchContext?.mode || null,
      researchSourceCount: sourcePageIds.length,
      researchCapturedAt: researchContext?.captured_at || null,
      reportContextVersion: reportSnapshot?.context_version || null,
      reportContextHash,
      reportStatus,
      reportCount: reportStatus === "ready" ? reportIds.length : 0,
      reportCapturedAt: reportSnapshot?.captured_at || null,
      promptIdentityHash,
      cacheIdentityMode: reportEvidenceContext
        ? "prompt-identity-v2-report-evidence"
        : firstClassContext
          ? "prompt-identity-v1"
          : "legacy-evidence-hash",
    },
    relatedReports: frozenReports,
    selectionReasons: debateReasons(row.selection_reasons),
    status,
    model: row.model,
    modelRoute: modelRoute(row.model_route),
    promptVersion: row.prompt_version,
    deterministicSignal: row.deterministic_signal,
    deterministicScore: Number(row.deterministic_score || 0),
    deterministicRiskStatus: row.deterministic_risk_status,
    bull: bullBear(row.bull_payload),
    bear: bullBear(row.bear_payload),
    risk: risk(row.risk_payload),
    chair: chair(row.chair_payload),
    callAudit: row.call_audit,
    inputTokens: Number(row.input_tokens || 0),
    cachedInputTokens: Number(row.cached_input_tokens || 0),
    outputTokens: Number(row.output_tokens || 0),
    reasoningTokens: Number(row.reasoning_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    latencyMs: Number(row.latency_ms || 0),
    estimatedCostUsd: nullableNumber(row.estimated_cost_usd),
    escalated: Boolean(row.escalated),
    escalationReason: row.escalation_reason || "",
    fallbackUsed: Boolean(row.fallback_used),
    error: row.error || "",
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export async function getAiCouncilDebateDashboardData(supabase: SupabaseClient): Promise<AiCouncilDebateDashboardData> {
  const generatedAt = new Date().toISOString()
  const route = getAiCouncilLlmModelRoute()
  const model = aiCouncilLlmModelRouteLabel(route)
  const enabledByConfiguration = Boolean(process.env.OPENAI_API_KEY)
    && !["false", "0", "off"].includes((process.env.AI_COUNCIL_LLM_ENABLED || "").trim().toLowerCase())

  const result = await supabase
    .from("ai_council_llm_debates")
    .select("run_id,ticker,as_of_date,selection_reasons,status,model,model_route,prompt_version,evidence_hash,deterministic_signal,deterministic_score,deterministic_risk_status,bull_payload,bear_payload,risk_payload,chair_payload,call_audit,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,latency_ms,estimated_cost_usd,escalated,escalation_reason,fallback_used,error,created_at,completed_at")
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(80)

  if (result.error) {
    return {
      generatedAt,
      latestDate: null,
      enabledByConfiguration,
      model,
      modelRoute: route,
      rows: [],
      completed: 0,
      partial: 0,
      failed: 0,
      escalated: 0,
      fallbackUsed: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      estimatedCostUsd: null,
      message: `Không đọc được LLM debate audit trail: ${result.error.message}`,
    }
  }

  const debateRows = (result.data || []) as DebateRow[]
  const runIds = debateRows.map((row) => row.run_id)
  const rawEvidenceByRun = new Map<string, RawEvidenceAuditRow>()
  const researchContextByRun = new Map<string, ResearchContextAuditRow>()
  const reportSnapshotByRun = new Map<string, ReportEvidenceSnapshotRow>()

  if (runIds.length) {
    const [rawEvidenceResult, researchContextResult, reportSnapshotResult] = await Promise.all([
      supabase
        .from("ai_council_llm_evidence")
        .select("run_id,context_version,context_hash,captured_at")
        .in("run_id", runIds),
      supabase
        .from("ai_council_llm_research_contexts")
        .select("run_id,context_version,context_hash,raw_context_hash,prompt_identity_hash,mode,status,source_page_ids,captured_at")
        .in("run_id", runIds),
      snapshotDb(supabase)
        .from("ai_council_report_evidence_snapshots")
        .select("run_id,context_version,context_hash,status,context_payload,report_ids,analysis_ids,captured_at")
        .in("run_id", runIds),
    ])

    if (!rawEvidenceResult.error) {
      for (const row of (rawEvidenceResult.data || []) as RawEvidenceAuditRow[]) rawEvidenceByRun.set(row.run_id, row)
    }
    if (!researchContextResult.error) {
      for (const row of (researchContextResult.data || []) as ResearchContextAuditRow[]) researchContextByRun.set(row.run_id, row)
    }
    if (!reportSnapshotResult.error) {
      for (const row of (reportSnapshotResult.data || []) as ReportEvidenceSnapshotRow[]) {
        reportSnapshotByRun.set(row.run_id, row)
      }
    }
  }

  const rows = debateRows.map((row) => normalize(
    row,
    rawEvidenceByRun.get(row.run_id),
    researchContextByRun.get(row.run_id),
    reportSnapshotByRun.get(row.run_id),
  ))
  const latestDate = rows[0]?.asOfDate || null
  const latestRows = latestDate ? rows.filter((row) => row.asOfDate === latestDate) : []
  const costRows = latestRows.filter((row) => row.estimatedCostUsd != null)
  const costComplete = latestRows.length > 0 && costRows.length === latestRows.length
  return {
    generatedAt,
    latestDate,
    enabledByConfiguration,
    model,
    modelRoute: route,
    rows,
    completed: latestRows.filter((row) => row.status === "completed").length,
    partial: latestRows.filter((row) => row.status === "partial").length,
    failed: latestRows.filter((row) => row.status === "failed").length,
    escalated: latestRows.filter((row) => row.escalated).length,
    fallbackUsed: latestRows.filter((row) => row.fallbackUsed).length,
    totalTokens: latestRows.reduce((sum, row) => sum + row.totalTokens, 0),
    cachedInputTokens: latestRows.reduce((sum, row) => sum + row.cachedInputTokens, 0),
    estimatedCostUsd: costComplete
      ? Number(costRows.reduce((sum, row) => sum + (row.estimatedCostUsd || 0), 0).toFixed(6))
      : null,
    message: rows.length
      ? "P4.4 uses frozen raw/research/report evidence, semantic grounding, prompt-identity cache telemetry and severe-conflict Sol escalation. Historical Research Reports are read from immutable Council snapshots only; debates remain advisory-only."
      : enabledByConfiguration
        ? "Runtime đã nhận OPENAI_API_KEY. Chưa có P4 debate vì cron chỉ chạy khi deterministic Council có event đáng tranh luận."
        : "P4 code đã sẵn sàng nhưng OPENAI_API_KEY chưa được cấu hình hoặc AI_COUNCIL_LLM_ENABLED đang tắt.",
  }
}