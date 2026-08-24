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
} from "@/lib/ai-council-llm"
import { resolveAiCouncilPromptIdentityHash } from "@/lib/ai-council-prompt-identity"
import { AI_COUNCIL_EVIDENCE_PACKET_VERSION } from "@/lib/ai-council-prompt-evidence"
import { INSIGHTS_METRIC_GUIDE_VERSION } from "@/lib/insights-metric-semantics"

interface DebateRow {
  id: string
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

export interface AiCouncilDebateDashboardData {
  generatedAt: string
  latestDate: string | null
  enabledByConfiguration: boolean
  model: string
  modelRoute: CouncilLlmModelRoute
  rows: AiCouncilLlmDebateRecord[]
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
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

function normalize(
  row: DebateRow,
  rawEvidence: RawEvidenceAuditRow | undefined,
  researchContext: ResearchContextAuditRow | undefined,
): AiCouncilLlmDebateRecord {
  const status = row.status === "completed" || row.status === "partial" || row.status === "failed" ? row.status : "pending"
  const firstClassContext = row.prompt_version === "llm-debate-v3-first-class-context"
  const semanticPacket = firstClassContext || row.prompt_version === "llm-debate-v2-semantic-grounding"
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
      }, row.prompt_version)
    : row.evidence_hash
  const sourcePageIds = Array.isArray(researchContext?.source_page_ids) ? researchContext.source_page_ids : []

  return {
    id: row.id,
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
      promptIdentityHash,
      cacheIdentityMode: firstClassContext ? "prompt-identity-v1" : "legacy-evidence-hash",
    },
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
    .select("id,run_id,ticker,as_of_date,selection_reasons,status,model,model_route,prompt_version,evidence_hash,deterministic_signal,deterministic_score,deterministic_risk_status,bull_payload,bear_payload,risk_payload,chair_payload,call_audit,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,latency_ms,estimated_cost_usd,escalated,escalation_reason,fallback_used,error,created_at,completed_at")
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

  if (runIds.length) {
    const [rawEvidenceResult, researchContextResult] = await Promise.all([
      supabase
        .from("ai_council_llm_evidence")
        .select("run_id,context_version,context_hash,captured_at")
        .in("run_id", runIds),
      supabase
        .from("ai_council_llm_research_contexts")
        .select("run_id,context_version,context_hash,raw_context_hash,prompt_identity_hash,mode,status,source_page_ids,captured_at")
        .in("run_id", runIds),
    ])

    if (!rawEvidenceResult.error) {
      for (const row of (rawEvidenceResult.data || []) as RawEvidenceAuditRow[]) rawEvidenceByRun.set(row.run_id, row)
    }
    if (!researchContextResult.error) {
      for (const row of (researchContextResult.data || []) as ResearchContextAuditRow[]) researchContextByRun.set(row.run_id, row)
    }
  }

  const rows = debateRows.map((row) => normalize(row, rawEvidenceByRun.get(row.run_id), researchContextByRun.get(row.run_id)))
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
      ? "P4.3 uses first-class raw/research evidence, semantic grounding, prompt-identity cache telemetry and severe-conflict Sol escalation. Debates remain immutable per deterministic run and advisory-only."
      : enabledByConfiguration
        ? "Runtime đã nhận OPENAI_API_KEY. Chưa có P4 debate vì cron chỉ chạy khi deterministic Council có event đáng tranh luận."
        : "P4 code đã sẵn sàng nhưng OPENAI_API_KEY chưa được cấu hình hoặc AI_COUNCIL_LLM_ENABLED đang tắt.",
  }
}
