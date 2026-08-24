import { sanitizeAdminValue } from "./redact.ts"
import { getAdminJobDefinition } from "./catalog.ts"

async function getSupabase() {
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  return getSupabaseServerClient()
}

export interface ExecuteSystemJobInput<T> {
  jobKey: string
  trigger: "schedule" | "manual" | "workflow" | "external"
  actorUserId?: string | null
  telemetry?: "best_effort" | "required"
  fn: (runId: string | null) => Promise<T>
  extractSummary?: (result: T) => Record<string, unknown>
}

export async function executeSystemJob<T>(input: ExecuteSystemJobInput<T>): Promise<{ runId: string | null; result: T }> {
  const startedAt = new Date()
  let runId: string | null = null
  const supabase = await getSupabase()
  const provider = getAdminJobDefinition(input.jobKey)?.provider

  if (!provider && input.telemetry === "required") {
    throw new Error(`Unknown job definition: ${input.jobKey}`)
  }

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("system_job_runs")
        .insert({
          job_key: input.jobKey,
          provider: provider ?? "unknown",
          trigger: input.trigger,
          actor_user_id: input.actorUserId ?? null,
          status: "running",
          started_at: startedAt.toISOString(),
        })
        .select("id")
        .single()

      if (error) throw error
      if (data?.id) {
        runId = String(data.id)
      }
    } catch (err: unknown) {
      console.warn(`Failed to record job start telemetry for ${input.jobKey}:`, err)
      if (input.telemetry === "required") throw new Error("Không thể khởi tạo telemetry an toàn cho tác vụ.")
    }
  }

  if ((!supabase || !runId) && input.telemetry === "required") {
    throw new Error("Telemetry storage is not available; tác vụ chưa được chạy.")
  }

  try {
    const result = await input.fn(runId)
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    if (supabase && runId) {
      try {
        let summary: unknown = null
        if (input.extractSummary) {
          try {
            summary = sanitizeAdminValue(input.extractSummary(result))
          } catch {
            summary = null
          }
        }

        const { error } = await supabase
          .from("system_job_runs")
          .update({
            status: "succeeded",
            finished_at: finishedAt.toISOString(),
            duration_ms: durationMs,
            summary: summary as Record<string, unknown> | null,
          })
          .eq("id", runId)
        if (error) throw error
      } catch (err: unknown) {
        console.warn(`Failed to record job success telemetry for ${input.jobKey}:`, err)
      }
    }

    return { runId, result }
  } catch (error: unknown) {
    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorCode = (error as { code?: string })?.code || "JOB_EXECUTION_ERROR"

    if (supabase && runId) {
      try {
        const { error: updateError } = await supabase
          .from("system_job_runs")
          .update({
            status: "failed",
            finished_at: finishedAt.toISOString(),
            duration_ms: durationMs,
            error_code: String(errorCode).slice(0, 100),
            error_message: String(errorMessage).slice(0, 1000),
          })
          .eq("id", runId)
        if (updateError) throw updateError
      } catch (err: unknown) {
        console.warn(`Failed to record job failure telemetry for ${input.jobKey}:`, err)
      }
    }

    throw error
  }
}
