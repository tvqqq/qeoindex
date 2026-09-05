import { sanitizeAdminValue } from "../../admin/redact.ts"
import { RESEARCH_REPORT_PRICING_VERSION } from "../analysis/pricing.ts"
import type { ResearchReportAiBudgetSnapshot } from "../analysis/budget.ts"
import type { ResearchReportWorkflowCandidate } from "./orchestrator.ts"

export const RESEARCH_REPORTS_DAILY_JOB_KEY = "research_reports.daily"
export const RESEARCH_REPORTS_BACKFILL_JOB_KEY = "research_reports.backfill"
export const RESEARCH_REPORTS_DAILY_PROVIDER = "supabase_pg_cron"
export const RESEARCH_REPORTS_BACKFILL_PROVIDER = "manual"

export const RESEARCH_REPORT_PHASES = [
  "DISCOVER",
  "UPSERT_METADATA",
  "FETCH_PARSE",
  "AI_ANALYZE",
  "PUBLISH",
  "FINALIZE",
] as const

export type ResearchReportPhaseKey = (typeof RESEARCH_REPORT_PHASES)[number]
export type ResearchReportRunStatus = "succeeded" | "partial" | "failed"

export interface ResearchReportAttemptUsage {
  attemptedModels: string[]
  aiRequestCount: number
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  unknownUsageAttempts: number
  estimatedCostUsd: number
  pricingVersion: string
}

export interface ResearchReportRunItemEvidence {
  runId: string
  jobKey: string
  candidate: ResearchReportWorkflowCandidate
  contentHash: string | null
  outcome:
    | "ready"
    | "skipped_existing"
    | "skipped_concurrent"
    | "needs_ocr"
    | "unsupported"
    | "failed"
    | "deferred_budget"
    | "deferred_report_limit"
  terminalStage: string
  errorCode?: string | null
  errorMessage?: string | null
  usage: ResearchReportAttemptUsage
  startedAt: string
  finishedAt: string
}

interface DbError { message?: string }
interface RunInsertResult { data: { id?: unknown } | null; error: DbError | null }
interface GenericResult { error: DbError | null }

interface RunInsertBuilder {
  select(columns: string): { single(): PromiseLike<RunInsertResult> }
}
interface PhaseInsertBuilder { insert(rows: Record<string, unknown>[]): PromiseLike<GenericResult> }
interface RunTable {
  insert(row: Record<string, unknown>): RunInsertBuilder
  update(row: Record<string, unknown>): { eq(column: string, value: unknown): PromiseLike<GenericResult> }
}
interface PhaseTable {
  insert(rows: Record<string, unknown>[]): PromiseLike<GenericResult>
  update(row: Record<string, unknown>): {
    eq(column: string, value: unknown): {
      eq(column: string, value: unknown): PromiseLike<GenericResult>
    }
  }
}
interface RunItemTable {
  upsert(row: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<GenericResult>
}
interface ResearchReportTelemetrySupabase {
  from(table: "system_job_runs"): RunTable
  from(table: "system_job_phases"): PhaseTable
  from(table: "market_research_report_run_items"): RunItemTable
}

async function getTelemetryDb(): Promise<ResearchReportTelemetrySupabase> {
  const { getSupabaseServerClient } = await import("../../shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured for Research Reports telemetry")
  return supabase as unknown as ResearchReportTelemetrySupabase
}

function safeSummary(value: Record<string, unknown>) {
  return sanitizeAdminValue(value) as Record<string, unknown>
}

function durationMs(startedAt: string, finishedAt: string) {
  return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
}

export async function startResearchReportsRunStep(input: {
  jobKey: string
  provider: string
  trigger: "workflow" | "manual"
  startedAt: string
  actorUserId?: string | null
}): Promise<string> {
  "use step"
  const db = await getTelemetryDb()
  const { data, error } = await db.from("system_job_runs")
    .insert({
      job_key: input.jobKey,
      provider: input.provider,
      trigger: input.trigger,
      status: "running",
      actor_user_id: input.actorUserId ?? null,
      started_at: input.startedAt,
      summary: { stage: "DISCOVER" },
    })
    .select("id")
    .single()

  if (error || typeof data?.id !== "string") {
    throw new Error(`Research Reports run telemetry start failed: ${error?.message || "missing run id"}`)
  }

  const rows = RESEARCH_REPORT_PHASES.map((phase, index) => ({
    run_id: data.id,
    job_key: input.jobKey,
    phase_key: phase,
    phase_order: index + 1,
    status: "queued",
    summary: {},
  }))
  const phaseInsert: PhaseInsertBuilder = db.from("system_job_phases")
  const phaseResult = await phaseInsert.insert(rows)
  if (phaseResult.error) throw new Error(`Research Reports phase telemetry start failed: ${phaseResult.error.message || "unknown"}`)

  return data.id
}

export async function updateResearchReportsPhaseStep(input: {
  runId: string
  phase: ResearchReportPhaseKey
  status: "running" | "succeeded" | "failed" | "skipped"
  summary?: Record<string, unknown>
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  "use step"
  const db = await getTelemetryDb()
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: input.status,
    summary: safeSummary(input.summary ?? {}),
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage?.slice(0, 800) ?? null,
  }
  if (input.status === "running") patch.started_at = now
  else patch.finished_at = now

  const result = await db.from("system_job_phases")
    .update(patch)
    .eq("run_id", input.runId)
    .eq("phase_key", input.phase)
  if (result.error) throw new Error(`Research Reports phase telemetry update failed: ${result.error.message || "unknown"}`)
}

export async function persistResearchReportRunItemStep(evidence: ResearchReportRunItemEvidence): Promise<void> {
  "use step"
  const db = await getTelemetryDb()
  const usage = evidence.usage
  const result = await db.from("market_research_report_run_items").upsert({
    run_id: evidence.runId,
    job_key: evidence.jobKey,
    report_id: evidence.candidate.id,
    provider: evidence.candidate.provider,
    external_report_id: evidence.candidate.externalReportId,
    publish_date: evidence.candidate.publishDate,
    content_hash: evidence.contentHash,
    outcome: evidence.outcome,
    terminal_stage: evidence.terminalStage,
    error_code: evidence.errorCode ?? null,
    error_message: evidence.errorMessage?.slice(0, 800) ?? null,
    attempted_models: usage.attemptedModels,
    ai_request_count: usage.aiRequestCount,
    input_tokens: usage.inputTokens,
    cached_input_tokens: usage.cachedInputTokens,
    cache_write_tokens: usage.cacheWriteTokens,
    output_tokens: usage.outputTokens,
    reasoning_tokens: usage.reasoningTokens,
    total_tokens: usage.totalTokens,
    unknown_usage_attempts: usage.unknownUsageAttempts,
    estimated_cost_usd: usage.estimatedCostUsd,
    pricing_version: usage.pricingVersion || RESEARCH_REPORT_PRICING_VERSION,
    started_at: evidence.startedAt,
    finished_at: evidence.finishedAt,
    duration_ms: durationMs(evidence.startedAt, evidence.finishedAt),
    updated_at: evidence.finishedAt,
  }, { onConflict: "run_id,report_id", ignoreDuplicates: false })
  if (result.error) throw new Error(`Research Reports run-item telemetry failed: ${result.error.message || "unknown"}`)
}

export async function finishResearchReportsRunStep(input: {
  runId: string
  startedAt: string
  status: Exclude<ResearchReportRunStatus, "failed">
  summary: Record<string, unknown>
  budgetSnapshot: ResearchReportAiBudgetSnapshot
}): Promise<void> {
  "use step"
  const db = await getTelemetryDb()
  const finishedAt = new Date().toISOString()
  const summary = safeSummary({
    ...input.summary,
    aiRequestCount: input.budgetSnapshot.requestAttempts,
    estimatedCostUsd: input.budgetSnapshot.estimatedCostUsd,
    maxEstimatedCostUsd: input.budgetSnapshot.maxEstimatedCostUsd,
    unknownUsageAttempts: input.budgetSnapshot.unknownUsageAttempts,
    budgetExhausted: input.budgetSnapshot.budgetExhausted,
    budgetReason: input.budgetSnapshot.budgetReason,
    pricingVersion: RESEARCH_REPORT_PRICING_VERSION,
  })
  const result = await db.from("system_job_runs").update({
    status: input.status,
    finished_at: finishedAt,
    duration_ms: durationMs(input.startedAt, finishedAt),
    summary,
    error_code: null,
    error_message: null,
  }).eq("id", input.runId)
  if (result.error) throw new Error(`Research Reports run telemetry finish failed: ${result.error.message || "unknown"}`)
}

export async function failResearchReportsRunStep(input: {
  runId: string
  startedAt: string
  errorMessage: string
  errorCode?: string
}): Promise<void> {
  "use step"
  const db = await getTelemetryDb()
  const finishedAt = new Date().toISOString()
  const errorCode = input.errorCode ?? "RESEARCH_REPORTS_DAILY_FAILED"
  const errorMessage = input.errorMessage.slice(0, 800)

  const running = await db.from("system_job_phases")
    .update({ status: "failed", finished_at: finishedAt, error_code: errorCode, error_message: errorMessage })
    .eq("run_id", input.runId)
    .eq("status", "running")
  if (running.error) throw new Error(`Research Reports running phase cleanup failed: ${running.error.message || "unknown"}`)

  const queued = await db.from("system_job_phases")
    .update({ status: "skipped", finished_at: finishedAt, error_code: errorCode, error_message: "Skipped because the parent workflow failed" })
    .eq("run_id", input.runId)
    .eq("status", "queued")
  if (queued.error) throw new Error(`Research Reports queued phase cleanup failed: ${queued.error.message || "unknown"}`)

  const result = await db.from("system_job_runs").update({
    status: "failed",
    finished_at: finishedAt,
    duration_ms: durationMs(input.startedAt, finishedAt),
    summary: { stage: "FAILED" },
    error_code: errorCode,
    error_message: errorMessage,
  }).eq("id", input.runId)
  if (result.error) throw new Error(`Research Reports run telemetry failure update failed: ${result.error.message || "unknown"}`)
}
