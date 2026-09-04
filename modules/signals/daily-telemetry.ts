import { sanitizeAdminValue } from "../admin/redact.ts"

export const SIGNALS_DAILY_JOB_KEY = "signals.daily"
export const SIGNALS_DAILY_PROVIDER = "vercel_cron_workflow"

export type SignalsDailyStage =
  | "SCANNER"
  | "WAIT_OPEN"
  | "OPENING"
  | "MORNING"
  | "LUNCH"
  | "AFTERNOON"
  | "CLOSING"
  | "COMPLETED"
  | "FAILED"

export interface SignalsDailyTelemetryIo {
  insertRun(row: {
    job_key: string
    provider: string
    trigger: string
    status: string
    started_at: string
    summary?: Record<string, unknown> | null
  }): Promise<string>
  updateRun(
    runId: string,
    updates: {
      status?: string
      finished_at?: string
      duration_ms?: number
      summary?: Record<string, unknown> | null
      error_code?: string | null
      error_message?: string | null
    },
  ): Promise<void>
}

async function getDefaultIo(): Promise<SignalsDailyTelemetryIo> {
  const { getSupabaseServerClient } = await import("../../modules/shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) {
    throw new Error("Supabase service role is not configured for Signals Daily telemetry")
  }

  return {
    async insertRun(row) {
      const { data, error } = await supabase
        .from("system_job_runs")
        .insert(row)
        .select("id")
        .single()
      if (error || !data?.id) {
        throw new Error(`Signals Daily telemetry start failed: ${error?.message || "missing run ID"}`)
      }
      return String(data.id)
    },
    async updateRun(runId, updates) {
      const { error } = await supabase
        .from("system_job_runs")
        .update(updates)
        .eq("id", runId)
      if (error) {
        throw new Error(`Signals Daily telemetry update failed: ${error.message}`)
      }
    },
  }
}

export async function startSignalsDailyRunStep(startedAtIso: string, customIo?: SignalsDailyTelemetryIo): Promise<string> {
  "use step"
  const io = customIo ?? await getDefaultIo()
  return io.insertRun({
    job_key: SIGNALS_DAILY_JOB_KEY,
    provider: SIGNALS_DAILY_PROVIDER,
    trigger: "workflow",
    status: "running",
    started_at: startedAtIso,
    summary: { stage: "SCANNER" },
  })
}

export async function updateSignalsDailyStageStep(
  runId: string,
  stage: SignalsDailyStage,
  details: Record<string, unknown> = {},
  customIo?: SignalsDailyTelemetryIo,
): Promise<{ ok: true; stage: SignalsDailyStage }> {
  "use step"
  const io = customIo ?? await getDefaultIo()
  const sanitizedSummary = sanitizeAdminValue({ stage, ...details }) as Record<string, unknown>

  await io.updateRun(runId, {
    summary: sanitizedSummary,
  })

  return { ok: true, stage }
}

export async function finishSignalsDailyRunStep(
  runId: string,
  startedAtIso: string,
  summary: Record<string, unknown>,
  customIo?: SignalsDailyTelemetryIo,
): Promise<{ ok: true; status: "succeeded" }> {
  "use step"
  const io = customIo ?? await getDefaultIo()
  const finishedAt = new Date().toISOString()
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAtIso).getTime())
  const sanitizedSummary = sanitizeAdminValue(summary) as Record<string, unknown>

  await io.updateRun(runId, {
    status: "succeeded",
    finished_at: finishedAt,
    duration_ms: durationMs,
    summary: sanitizedSummary,
    error_code: null,
    error_message: null,
  })

  return { ok: true, status: "succeeded" }
}

export async function failSignalsDailyRunStep(
  runId: string,
  startedAtIso: string,
  errorMessage: string,
  customIo?: SignalsDailyTelemetryIo,
): Promise<{ ok: true; status: "failed" }> {
  "use step"
  const io = customIo ?? await getDefaultIo()
  const finishedAt = new Date().toISOString()
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAtIso).getTime())

  await io.updateRun(runId, {
    status: "failed",
    finished_at: finishedAt,
    duration_ms: durationMs,
    summary: { stage: "FAILED" },
    error_code: "SIGNALS_DAILY_FAILED",
    error_message: errorMessage.slice(0, 1000),
  })

  return { ok: true, status: "failed" }
}
