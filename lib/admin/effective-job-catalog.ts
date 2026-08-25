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
  "qeoindex.eod_pipeline",
  "wyckoff.ingest",
  "ai_council.daily",
  "ai_council.debate_daily",
])

/**
 * Operational Admin Jobs catalog for the notion-unified-v2 target architecture.
 *
 * Base endpoint-level definitions are retained for compatibility, but the
 * effective catalog always exposes exactly one canonical parent pipeline. This
 * prevents duplicate/raw definitions from leaking into /admin/jobs while the
 * actual trigger remains Supabase pg_cron and execution remains Vercel Workflow.
 */
export const EFFECTIVE_ADMIN_JOB_CATALOG: AdminJobDefinition[] = [
  QEOINDEX_EOD_PIPELINE_JOB,
  ...ADMIN_JOB_CATALOG.filter((job) => !LEGACY_EOD_JOB_KEYS.has(job.key)),
]

export function getEffectiveAdminJobDefinition(key: string): AdminJobDefinition | undefined {
  return EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === key)
}
