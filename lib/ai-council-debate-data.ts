import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  AiCouncilLlmDebateRecord,
  DebateSelectionReason,
  LlmBullBearPayload,
  LlmChairPayload,
  LlmRiskPayload,
} from "@/lib/ai-council-llm"

interface DebateRow {
  id: string
  run_id: string
  ticker: string
  as_of_date: string
  selection_reasons: unknown
  status: string
  model: string
  prompt_version: string
  deterministic_signal: string
  deterministic_score: number
  deterministic_risk_status: string
  bull_payload: unknown
  bear_payload: unknown
  risk_payload: unknown
  chair_payload: unknown
  call_audit: unknown
  input_tokens: number
  output_tokens: number
  total_tokens: number
  latency_ms: number
  error: string
  created_at: string
  completed_at: string | null
}

export interface AiCouncilDebateDashboardData {
  generatedAt: string
  latestDate: string | null
  enabledByConfiguration: boolean
  model: string
  rows: AiCouncilLlmDebateRecord[]
  completed: number
  partial: number
  failed: number
  totalTokens: number
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

function normalize(row: DebateRow): AiCouncilLlmDebateRecord {
  const status = row.status === "completed" || row.status === "partial" || row.status === "failed" ? row.status : "pending"
  return {
    id: row.id,
    runId: row.run_id,
    ticker: row.ticker,
    asOfDate: row.as_of_date,
    selectionReasons: debateReasons(row.selection_reasons),
    status,
    model: row.model,
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
    outputTokens: Number(row.output_tokens || 0),
    totalTokens: Number(row.total_tokens || 0),
    latencyMs: Number(row.latency_ms || 0),
    error: row.error || "",
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

export async function getAiCouncilDebateDashboardData(supabase: SupabaseClient): Promise<AiCouncilDebateDashboardData> {
  const generatedAt = new Date().toISOString()
  const model = (process.env.AI_COUNCIL_LLM_MODEL || "gpt-5-mini").trim() || "gpt-5-mini"
  const enabledByConfiguration = Boolean(process.env.OPENAI_API_KEY)
    && !["false", "0", "off"].includes((process.env.AI_COUNCIL_LLM_ENABLED || "").trim().toLowerCase())

  const result = await supabase
    .from("ai_council_llm_debates")
    .select("id,run_id,ticker,as_of_date,selection_reasons,status,model,prompt_version,deterministic_signal,deterministic_score,deterministic_risk_status,bull_payload,bear_payload,risk_payload,chair_payload,call_audit,input_tokens,output_tokens,total_tokens,latency_ms,error,created_at,completed_at")
    .order("as_of_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(80)

  if (result.error) {
    return {
      generatedAt,
      latestDate: null,
      enabledByConfiguration,
      model,
      rows: [],
      completed: 0,
      partial: 0,
      failed: 0,
      totalTokens: 0,
      message: `Không đọc được LLM debate audit trail: ${result.error.message}`,
    }
  }

  const rows = ((result.data || []) as DebateRow[]).map(normalize)
  const latestDate = rows[0]?.asOfDate || null
  const latestRows = latestDate ? rows.filter((row) => row.asOfDate === latestDate) : []
  return {
    generatedAt,
    latestDate,
    enabledByConfiguration,
    model,
    rows,
    completed: latestRows.filter((row) => row.status === "completed").length,
    partial: latestRows.filter((row) => row.status === "partial").length,
    failed: latestRows.filter((row) => row.status === "failed").length,
    totalTokens: latestRows.reduce((sum, row) => sum + row.totalTokens, 0),
    message: rows.length
      ? "P4 debates are immutable per deterministic run. Bull/Bear/Risk use the same point-in-time packet; the LLM Chair is advisory-only."
      : enabledByConfiguration
        ? "Chưa có P4 debate. Cron sẽ chỉ chạy khi deterministic Council có event đáng tranh luận."
        : "P4 code đã sẵn sàng nhưng OPENAI_API_KEY chưa được cấu hình hoặc AI_COUNCIL_LLM_ENABLED đang tắt.",
  }
}
