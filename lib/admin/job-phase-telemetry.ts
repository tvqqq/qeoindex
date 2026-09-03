import {
  QEOINDEX_EOD_INTERNAL_PHASE_TO_BUSINESS,
  QEOINDEX_EOD_JOB_KEY,
  QEOINDEX_EOD_PHASES,
  type QeoIndexEodPhaseKey,
} from "./job-phases.ts"
import { sanitizeAdminValue } from "./redact.ts"

export interface QeoIndexEodPhaseIo {
  upsertPhase(row: Record<string, unknown>): Promise<void>
}

type QeoIndexEodTelemetryPhaseKey = QeoIndexEodPhaseKey | "DRIVE_ARCHIVE"

async function getDefaultIo(): Promise<QeoIndexEodPhaseIo> {
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured for phase telemetry")

  return {
    async upsertPhase(row) {
      const { error } = await supabase
        .from("system_job_phases")
        .upsert(row, { onConflict: "run_id,phase_key" })
      if (error) throw new Error(`QeoIndex EOD phase telemetry write failed: ${error.message}`)
    },
  }
}

function phaseDefinition(phaseKey: QeoIndexEodTelemetryPhaseKey) {
  if (phaseKey === "DRIVE_ARCHIVE") {
    return {
      key: "DRIVE_ARCHIVE" as const,
      order: 99,
      label: "Legacy Drive Archive",
      description: "Legacy recovery-only Drive checkpoint; not part of active EOD v4.",
    }
  }
  const definition = QEOINDEX_EOD_PHASES.find((phase) => phase.key === phaseKey)
  if (!definition) throw new Error(`Unknown QeoIndex EOD phase: ${phaseKey}`)
  return definition
}

function errorDetails(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { code?: unknown } | null)?.code
  return {
    error_code: String(code || "PHASE_EXECUTION_ERROR").slice(0, 100),
    error_message: message.slice(0, 1000),
  }
}

function sanitizedSummary(value: unknown): Record<string, unknown> {
  const sanitized = sanitizeAdminValue(value)
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return {}
  return sanitized as Record<string, unknown>
}

function businessPhaseFor(phaseKey: QeoIndexEodTelemetryPhaseKey) {
  return phaseKey === "DRIVE_ARCHIVE"
    ? "POST_ANALYSIS"
    : QEOINDEX_EOD_INTERNAL_PHASE_TO_BUSINESS[phaseKey]
}

function phaseSummary(phaseKey: QeoIndexEodTelemetryPhaseKey, value: unknown = {}) {
  return sanitizedSummary({
    ...sanitizedSummary(value),
    businessPhase: businessPhaseFor(phaseKey),
  })
}

export async function runQeoIndexEodPhase<T>(input: {
  runId: string
  phaseKey: QeoIndexEodTelemetryPhaseKey
  fn: () => Promise<T>
  summarize?: (result: T) => unknown
  io?: QeoIndexEodPhaseIo
}): Promise<T> {
  if (!input.runId) throw new Error("QeoIndex EOD phase telemetry requires runId")
  const definition = phaseDefinition(input.phaseKey)
  const io = input.io ?? await getDefaultIo()
  const startedAt = new Date()

  await io.upsertPhase({
    run_id: input.runId,
    job_key: QEOINDEX_EOD_JOB_KEY,
    phase_key: definition.key,
    phase_order: definition.order,
    status: "running",
    started_at: startedAt.toISOString(),
    finished_at: null,
    duration_ms: null,
    summary: phaseSummary(input.phaseKey),
    error_code: null,
    error_message: null,
  })

  try {
    const result = await input.fn()
    const finishedAt = new Date()
    const summary = phaseSummary(input.phaseKey, input.summarize ? input.summarize(result) : {})
    await io.upsertPhase({
      run_id: input.runId,
      job_key: QEOINDEX_EOD_JOB_KEY,
      phase_key: definition.key,
      phase_order: definition.order,
      status: "succeeded",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      summary,
      error_code: null,
      error_message: null,
    })
    return result
  } catch (error) {
    const finishedAt = new Date()
    const details = errorDetails(error)
    await io.upsertPhase({
      run_id: input.runId,
      job_key: QEOINDEX_EOD_JOB_KEY,
      phase_key: definition.key,
      phase_order: definition.order,
      status: "failed",
      started_at: startedAt.toISOString(),
      finished_at: finishedAt.toISOString(),
      duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      summary: phaseSummary(input.phaseKey),
      ...details,
    })
    throw error
  }
}

export async function markQeoIndexEodPhaseSkipped(input: {
  runId: string
  phaseKey: QeoIndexEodPhaseKey
  reason: string
  io?: QeoIndexEodPhaseIo
}) {
  if (!input.runId) throw new Error("QeoIndex EOD phase telemetry requires runId")
  const definition = phaseDefinition(input.phaseKey)
  const io = input.io ?? await getDefaultIo()
  const now = new Date().toISOString()
  await io.upsertPhase({
    run_id: input.runId,
    job_key: QEOINDEX_EOD_JOB_KEY,
    phase_key: definition.key,
    phase_order: definition.order,
    status: "skipped",
    started_at: now,
    finished_at: now,
    duration_ms: 0,
    summary: phaseSummary(input.phaseKey, { reason: input.reason }),
    error_code: null,
    error_message: null,
  })
}

export async function markQeoIndexEodPhaseRetryingStep(input: {
  runId: string
  phaseKey: QeoIndexEodPhaseKey
  attemptsUsed: number
  nextAttemptAt: string
  lastError: string
}) {
  "use step"
  if (!input.runId) throw new Error("QeoIndex EOD phase telemetry requires runId")
  const definition = phaseDefinition(input.phaseKey)
  const io = await getDefaultIo()
  const now = new Date().toISOString()

  await io.upsertPhase({
    run_id: input.runId,
    job_key: QEOINDEX_EOD_JOB_KEY,
    phase_key: definition.key,
    phase_order: definition.order,
    status: "running",
    started_at: now,
    finished_at: null,
    duration_ms: null,
    summary: phaseSummary(input.phaseKey, {
      attemptsUsed: input.attemptsUsed,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.lastError.slice(0, 500),
      retrying: true,
    }),
    error_code: null,
    error_message: null,
  })

  return { ok: true as const, status: "running" as const, attemptsUsed: input.attemptsUsed }
}

export async function annotateQeoIndexEodPhaseSummaryStep(input: {
  runId: string
  phaseKey: QeoIndexEodPhaseKey
  summary: Record<string, unknown>
}) {
  "use step"
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured for phase telemetry")

  const { error } = await supabase
    .from("system_job_phases")
    .update({ summary: phaseSummary(input.phaseKey, input.summary) })
    .eq("run_id", input.runId)
    .eq("phase_key", input.phaseKey)

  if (error) throw new Error(`QeoIndex EOD phase telemetry summary update failed: ${error.message}`)
  return { ok: true as const, attemptsUsed: Number(input.summary.attemptsUsed || 0) }
}
