import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import type { AdminJobDefinition } from "./types.ts"
import { withSchedulePolicy } from "./schedule-policy.ts"

const QEOINDEX_EOD_PIPELINE_JOB: AdminJobDefinition = {
  key: "qeoindex.eod_pipeline",
  provider: "supabase_pg_cron_workflow",
  label: "QeoIndex EOD Pipeline",
  description:
    "Canonical EOD v4 owner: same-session KFSP Rating → concurrent TTAI + market close → frozen READY → OHLCV/Wyckoff → Supabase publish → deterministic Council → Market Synthesis → LLM → post-analysis.",
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
    "MARKET_SYNTHESIS",
    "AI_COUNCIL_LLM",
    "RETENTION_CLEANUP",
    "NOTION_ARCHIVE",
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

function asEodRecoveryJob(
  job: AdminJobDefinition,
  label: string,
  description: string,
): AdminJobDefinition {
  return withSchedulePolicy({
    ...job,
    provider: "machine",
    label,
    description,
    scheduleUtc: undefined,
    scheduleIct: undefined,
    scheduleKind: "manual",
    schedulerName: undefined,
    scheduleDays: undefined,
    windowStartIct: undefined,
    windowEndIct: undefined,
    intervalMinutes: undefined,
    manualPolicy: "confirm",
    manualPurpose: "recovery",
    automatedParentKeys: ["qeoindex.eod_pipeline"],
  })
}

function asRetiredEodJob(
  job: AdminJobDefinition,
  label: string,
  description: string,
): AdminJobDefinition {
  return withSchedulePolicy({
    ...job,
    provider: "machine",
    label,
    description,
    scheduleUtc: undefined,
    scheduleIct: undefined,
    scheduleKind: "manual",
    schedulerName: undefined,
    scheduleDays: undefined,
    windowStartIct: undefined,
    windowEndIct: undefined,
    intervalMinutes: undefined,
    manualPolicy: "disabled",
    manualPurpose: "maintenance",
    automatedParentKeys: ["qeoindex.eod_pipeline"],
  })
}

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
    return asEodRecoveryJob(
      job,
      "KFSP Rating Refresh (Manual Recovery)",
      "EOD v4 15:15 owns same-session KFSP Rating before READY. Standalone 07:00 pg_cron is retired by QEO-64; this action remains only for operator recovery/backfill.",
    )
  }

  if (job.key === "kfsp.ttai_history") {
    return asEodRecoveryJob(
      job,
      "KFSP TTAI History (Manual Recovery)",
      "EOD v4 owns same-session TTAI after Rating and before READY. Standalone 07:10 pg_cron is retired by QEO-64; this action remains only for operator recovery/backfill.",
    )
  }

  if (job.key === "market.sync_eod") {
    return asRetiredEodJob(
      job,
      "Market EOD Sync (Retired)",
      "EOD v4 exclusively owns final market-close collection for the frozen canonical universe. Standalone 14:45/14:50 scheduling and manual dispatch are disabled; use the canonical EOD run/retry flow for recovery.",
    )
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
 * Canonical operational catalog after QEO-64 EOD v4 cutover.
 *
 * Exactly one post-market orchestration schedule exists: qeoindex.eod_pipeline.
 * KFSP Rating and TTAI remain manual recovery/backfill tools. The standalone
 * Market EOD action is retained only as disabled historical/maintenance
 * evidence because final market-close collection must preserve EOD frozen
 * lineage. Historical scheduler aliases remain readable via job-schedule.ts.
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
