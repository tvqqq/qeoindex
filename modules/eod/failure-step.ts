import { markQeoIndexEodPhaseSkipped } from "@/modules/admin/job-phase-telemetry"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

export async function failQeoIndexEodRunStep(runId: string, errorMessage: string) {
  "use step"
  const supabase = requiredSupabase()
  const finishedAt = new Date().toISOString()
  const boundedMessage = errorMessage.slice(0, 1000)

  const orphanedPhaseResult = await supabase
    .from("system_job_phases")
    .update({
      status: "failed",
      finished_at: finishedAt,
      error_code: "QEOINDEX_EOD_FAILED",
      error_message: boundedMessage,
    })
    .eq("run_id", runId)
    .eq("status", "running")
  if (orphanedPhaseResult.error) {
    throw new Error(`QeoIndex EOD orphan phase telemetry update failed: ${orphanedPhaseResult.error.message}`)
  }

  await markQeoIndexEodPhaseSkipped({
    runId,
    phaseKey: "COMPLETE",
    reason: "Pipeline stopped because an earlier phase failed.",
  })

  const result = await supabase
    .from("system_job_runs")
    .update({
      status: "failed",
      finished_at: finishedAt,
      error_code: "QEOINDEX_EOD_FAILED",
      error_message: boundedMessage,
    })
    .eq("id", runId)
  if (result.error) throw new Error(`QeoIndex EOD failure telemetry update failed: ${result.error.message}`)
  return { ok: true as const }
}
