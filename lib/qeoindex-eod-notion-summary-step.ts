import "server-only"

import { runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import type { EodArchiveCheckpoint } from "@/lib/qeoindex-eod-archive"
import {
  archiveEodAnalyticalSummaryToNotion,
  type EodAnalyticalSummaryInput,
} from "@/lib/qeoindex-eod-notion-summary"
import { getSupabaseServerClient } from "@/lib/supabase/server"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

export async function runNotionAnalyticalSummaryStep(
  runId: string,
  input: Omit<EodAnalyticalSummaryInput, "eodRunId">,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_ARCHIVE",
    fn: async (): Promise<EodArchiveCheckpoint> => {
      try {
        return await archiveEodAnalyticalSummaryToNotion(requiredSupabase(), { ...input, eodRunId: runId })
      } catch (error) {
        return {
          status: "error",
          archived: 0,
          requested: 1,
          rowCount: 0,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    },
    summarize: (result) => ({ ...result, archiveKind: "analytical_summary", operationalSourceOfTruth: "supabase" }),
  })
}
