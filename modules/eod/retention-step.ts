import "server-only"

import { runQeoIndexEodPhase } from "@/modules/admin/job-phase-telemetry"
import { runEodRetentionCleanup } from "@/modules/eod/archive"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

export async function runRetentionCleanupStep(runId: string, input: { tradingDate: string }) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "RETENTION_CLEANUP",
    fn: () => runEodRetentionCleanup(requiredSupabase(), input),
    summarize: (result) => result,
  })
}
