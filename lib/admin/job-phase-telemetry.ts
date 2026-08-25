import { QEOINDEX_EOD_JOB_KEY, QEOINDEX_EOD_PHASES, type QeoIndexEodPhaseKey } from "./job-phases.ts"
import { sanitizeAdminValue } from "./redact.ts"

export interface QeoIndexEodPhaseIo {
  upsertPhase(row: Record<string, unknown>): Promise<void>
}

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

function phaseDefinition(phaseKey: QeoIndexEodPhaseKey) {
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

export async function runQeoIndexEodPhase<T>(input: {
  runId: string
  phaseKey: QeoIndexEodPhaseKey
  fn: () => Promise<T>
  summarize?: (result: T) => Record<string, unknown>
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
    summary: {},
    error_code: null,
    error_message: null,
  })

  try {
    const result = await input.fn()
    const finishedAt = new Date()
    const summary = input.summarize ? sanitizedSummary(input.summarize(result)) : {}
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
      summary: {},
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
    summary: sanitizedSummary({ reason: input.reason }),
    error_code: null,
    error_message: null,
  })
}
