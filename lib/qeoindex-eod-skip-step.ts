import { markQeoIndexEodPhaseSkipped } from "@/lib/admin/job-phase-telemetry"
import { getSupabaseServerClient } from "@/lib/supabase/server"

export async function skipQeoIndexEodRunStep(runId: string, scanDate: string, reason = "NON_TRADING_DAY") {
  "use step"
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")

  await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "EOD_READY", reason })
  await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "COMPLETE", reason })

  const finishedAt = new Date().toISOString()
  const summary = { skipped: true, scanDate, reason }
  const result = await supabase
    .from("system_job_runs")
    .update({
      status: "skipped",
      finished_at: finishedAt,
      summary,
      error_code: null,
      error_message: null,
    })
    .eq("id", runId)

  if (result.error) throw new Error(`QeoIndex EOD holiday skip telemetry failed: ${result.error.message}`)
  return { ok: true as const, skipped: true as const, runId, scanDate, reason, finishedAt }
}
