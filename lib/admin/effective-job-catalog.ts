import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import type { AdminJobDefinition } from "./types.ts"
import { withSchedulePolicy } from "./schedule-policy.ts"

const QEOINDEX_EOD_PIPELINE_JOB: AdminJobDefinition = {
  key: "qeoindex.eod_pipeline",
  provider: "supabase_pg_cron_workflow",
  label: "QeoIndex EOD Pipeline",
  description:
    "Một dependency chain cuối ngày: EOD Ready → History Refresh → Wyckoff Build → Notion Staging/Validate → Ingest → Supabase Publish → AI Council Deterministic → AI Council LLM.",
  group: "system",
  scheduleUtc: "15 8 * * 1-5",
  scheduleIct: "15:15 T2-T6",
  scheduleKind: "workflow",
  schedulerName: "qeoindex-eod-pipeline-1515-ict",
  scheduleDays: "weekdays",
  dependencies: [
    "EOD_READY",
    "HISTORY_REFRESH",
    "WYCKOFF_BUILD",
    "NOTION_STAGING",
    "NOTION_VALIDATE",
    "INGEST",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "AI_COUNCIL_LLM",
    "COMPLETE",
  ],
  evidenceSource: "system_job_runs",
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

function applyOperationalOverrides(job: AdminJobDefinition): AdminJobDefinition {
  if (job.key === "signals.daily") {
    return withSchedulePolicy({
      ...job,
      maxDurationMinutes: 8 * 60,
    })
  }

  if (job.key === "kfsp.ttai_history") {
    return withSchedulePolicy({
      ...job,
      description: "Kiểm tra và cập nhật lịch sử TTAI lúc 07:10 ICT khi kỳ báo cáo tài chính thay đổi.",
      scheduleUtc: "10 0 * * *",
      scheduleIct: "07:10 hàng ngày",
      schedulerName: "kfsp-ttai-history-daily-0710-ict",
    })
  }

  return withSchedulePolicy(job)
}

/**
 * Operational Admin Jobs catalog for the notion-unified-v2 target architecture.
 *
 * Base endpoint-level definitions are retained for compatibility, while this
 * effective catalog mirrors the actual production scheduler and workflow shape.
 */
export const EFFECTIVE_ADMIN_JOB_CATALOG: AdminJobDefinition[] = [
  withSchedulePolicy(QEOINDEX_EOD_PIPELINE_JOB),
  ...ADMIN_JOB_CATALOG
    .filter((job) => !LEGACY_EOD_JOB_KEYS.has(job.key))
    .map(applyOperationalOverrides),
]

export function getEffectiveAdminJobDefinition(key: string): AdminJobDefinition | undefined {
  return EFFECTIVE_ADMIN_JOB_CATALOG.find((job) => job.key === key)
}
