import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import type { AdminJobDefinition } from "./types.ts"

const QEOINDEX_EOD_PIPELINE_JOB: AdminJobDefinition = {
  key: "qeoindex.eod_pipeline",
  provider: "supabase_pg_cron_workflow",
  label: "QeoIndex EOD Pipeline",
  description:
    "Một dependency chain cuối ngày: EOD Ready → History Refresh → Wyckoff Build → Notion Staging/Validate → Ingest → Supabase Publish → AI Council Deterministic → AI Council LLM.",
  group: "system",
  scheduleUtc: "15 8 * * 1-5",
  scheduleIct: "15:15 T2-T6",
  manualPolicy: "disabled",
  freshnessMinutes: 26 * 60,
  maxDurationMinutes: 90,
}

const LEGACY_EOD_JOB_KEYS = new Set([
  "wyckoff.ingest",
  "ai_council.daily",
  "ai_council.debate_daily",
])

/**
 * Operational Admin Jobs catalog for the notion-unified-v2 target architecture.
 *
 * The base catalog still contains legacy endpoint-level jobs. The effective
 * catalog collapses those entries into one dependency-driven parent pipeline so
 * /admin/jobs presents the system as one EOD chain rather than independent
 * fixed-time jobs. The branch carrying this adapter must not be deployed until
 * the matching 15:15 orchestration trigger is enabled.
 */
export const EFFECTIVE_ADMIN_JOB_CATALOG: AdminJobDefinition[] = ADMIN_JOB_CATALOG.flatMap((job) => {
  if (job.key === "ai_council.daily") {
    return [QEOINDEX_EOD_PIPELINE_JOB]
  }

  if (LEGACY_EOD_JOB_KEYS.has(job.key)) {
    return []
  }

  return [job]
})

export function getEffectiveAdminJobDefinition(key: string): AdminJobDefinition | undefined {
  return EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === key)
}
