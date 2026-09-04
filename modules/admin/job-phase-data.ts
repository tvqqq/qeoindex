import { sanitizeAdminValue } from "./redact.ts"
import type { SystemJobPhaseRow } from "./job-phases.ts"

async function getSupabase() {
  const { getSupabaseServerClient } = await import("../../modules/shared/supabase/server.ts")
  return getSupabaseServerClient()
}

export async function loadAdminJobPhases(runId: string): Promise<SystemJobPhaseRow[]> {
  if (!runId) return []

  const supabase = await getSupabase()
  if (!supabase) return []

  try {
    const { data, error } = await supabase
      .from("system_job_phases")
      .select("*")
      .eq("run_id", runId)
      .order("phase_order", { ascending: true })

    if (error || !data) return []

    return (data as SystemJobPhaseRow[]).map((row) => ({
      ...row,
      summary: (sanitizeAdminValue(row.summary) as Record<string, unknown> | null | undefined) ?? null,
      error_code: row.error_code ? String(row.error_code).slice(0, 100) : null,
      error_message: row.error_message ? String(row.error_message).slice(0, 1000) : null,
    }))
  } catch {
    return []
  }
}
