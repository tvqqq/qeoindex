import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import type { AdminJobDefinition } from "./types.ts"
import { withSchedulePolicy } from "./schedule-policy.ts"

const QEOINDEX_EOD_PIPELINE_JOB: AdminJobDefinition = {
  key: "qeoindex.eod_pipeline",
  provider: "supabase_pg_cron_workflow",
  label: "QeoIndex EOD Pipeline",
  description:
    "Supabase-first EOD v3: readiness → market close → OHLCV → Wyckoff → Supabase validate/publish → AI Council → synthesis → Notion/Drive archive → retention.",
  group: "system",
  scheduleUtc: "15 8 * * 1-5",
  scheduleIct: "15:15 T2-T6",
  scheduleKind: "workflow",
  schedulerName: "qeoindex-eod-pipeline-1515-ict",
  scheduleDays: "weekdays",
  dependencies: [
    "EOD_READY",
    "MARKET_CLOSE_COLLECT",
    "HISTORY_REFRESH",
    "WYCKOFF_BUILD",
    "SUPABASE_VALIDATE",
    "SUPABASE_PUBLISH",
    "AI_COUNCIL_DETERMINISTIC",
    "AI_COUNCIL_LLM",
    "MARKET_SYNTHESIS",
    "NOTION_ARCHIVE",
    "DRIVE_ARCHIVE",
    "RETENTION_CLEANUP",
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

  if (job.key === "kfsp.rating_daily") {
    return withSchedulePolicy({
      ...job,
      description: "Đồng bộ lại snapshot KFSP canonical Top Stocks 200. Chạy thủ công yêu cầu xác nhận và dùng one-shot recovery dispatcher.",
      manualPolicy: "confirm",
    })
  }

  if (job.key === "kfsp.ttai_history") {
    return withSchedulePolicy({
      ...job,
      description: "Kiểm tra/cập nhật lịch sử TTAI lúc 07:10 ICT; chạy thủ công hỗ trợ batch tối đa 50 mã và force refresh qua one-shot recovery dispatcher.",
      scheduleUtc: "10 0 * * *",
      scheduleIct: "07:10 hàng ngày",
      schedulerName: "kfsp-ttai-history-daily-0710-ict",
      manualPolicy: "confirm",
    })
  }

  if (job.key === "market.sync_5m") {
    return withSchedulePolicy({
      ...job,
      description: "Đồng bộ orderbook canonical mỗi 5 phút chỉ trong hai phiên 09:00-11:30 và 13:00-14:40 ICT; không gọi provider trong giờ nghỉ trưa.",
      scheduleUtc: "*/5 2-4 * * 1-5; */5 6-7 * * 1-5",
      scheduleIct: "Mỗi 5p (09:00-11:30; 13:00-14:40 T2-T6)",
      windowStartIct: "09:00",
      windowEndIct: "14:40",
    })
  }

  return withSchedulePolicy(job)
}

/**
 * Operational Admin Jobs catalog for the canonical Top Stocks 200 / EOD v3 architecture.
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
