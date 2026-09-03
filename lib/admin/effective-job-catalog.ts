import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import type { AdminJobDefinition } from "./types.ts"
import { withSchedulePolicy } from "./schedule-policy.ts"

const QEOINDEX_EOD_PIPELINE_JOB: AdminJobDefinition = {
  key: "qeoindex.eod_pipeline",
  provider: "supabase_pg_cron_workflow",
  label: "QeoIndex EOD Pipeline",
  description:
    "EOD v4 data-refresh lane: same-session KFSP Rating → TTAI → market close → frozen READY → OHLCV/Wyckoff → Supabase publish → AI Council → post-analysis.",
  group: "system",
  scheduleUtc: "15 8 * * 1-5",
  scheduleIct: "15:15 T2-T6",
  scheduleKind: "workflow",
  schedulerName: "qeoindex-eod-pipeline-1515-ict",
  scheduleDays: "weekdays",
  dependencies: [
    "KFSP_RATING_REFRESH",
    "TTAI_REFRESH",
    "MARKET_CLOSE_COLLECT",
    "EOD_READY",
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
  "ai_council.daily",
  "ai_council.debate_daily",
])

function applyOperationalOverrides(job: AdminJobDefinition): AdminJobDefinition {
  if (job.key === "signals.daily") {
    return withSchedulePolicy({
      ...job,
      scheduleIct: "07:00–07:59 T2-T6 (Vercel Hobby)",
      maxDurationMinutes: 8 * 60,
    })
  }

  if (job.key === "wyckoff.ingest") {
    return withSchedulePolicy({
      ...job,
      provider: "machine",
      label: "Wyckoff Snapshot Ingest (Manual Recovery)",
      description: "Nhập lại snapshot từ Notion staging khi cần recovery dữ liệu legacy; canonical EOD không dùng tác vụ này làm scheduler chính.",
      scheduleUtc: undefined,
      scheduleIct: undefined,
      scheduleKind: "manual",
      schedulerName: undefined,
      scheduleDays: undefined,
      manualPolicy: "confirm",
      manualPurpose: "maintenance",
      automatedParentKeys: [],
    })
  }

  if (job.key === "kfsp.rating_daily") {
    return withSchedulePolicy({
      ...job,
      description: "Scheduler KFSP Rating 07:00 ICT vẫn giữ nguyên trong QEO-58. EOD 15:15 refresh lại same-session Rating trước READY; QEO-64 mới quyết định retire/reclassify sau production smoke.",
      manualPolicy: "confirm",
      manualPurpose: "recovery",
      automatedParentKeys: [],
    })
  }

  if (job.key === "kfsp.ttai_history") {
    return withSchedulePolicy({
      ...job,
      description: "Scheduler TTAI 07:10 ICT vẫn giữ nguyên trong QEO-58. EOD 15:15 kiểm tra/refresh lại TTAI theo frozen universe; QEO-64 mới quyết định retire/reclassify sau production smoke.",
      scheduleUtc: "10 0 * * *",
      scheduleIct: "07:10 hàng ngày",
      schedulerName: "kfsp-ttai-history-daily-0710-ict",
      manualPolicy: "confirm",
      manualPurpose: "recovery",
      automatedParentKeys: [],
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
 * Operational Admin Jobs catalog during the EOD v4 migration.
 *
 * QEO-58 makes the 15:15 EOD workflow own same-session KFSP/TTAI freshness.
 * Existing morning schedulers remain independently classified until QEO-64 production smoke.
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
