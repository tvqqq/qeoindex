import type { AdminJobDefinition, AdminJobView } from "./types.ts"

/**
 * Explicit 1-to-1 mapping between Supabase pg_cron job names (cron.job.jobname)
 * and canonical QeoIndex AdminJobDefinition keys.
 *
 * NEVER infer scheduler names by string replacement or regex.
 */
export const PG_CRON_NAME_TO_JOB_KEY: Readonly<Record<string, string>> = Object.freeze({
  "qeoindex-eod-pipeline-1515-ict": "qeoindex.eod_pipeline",
  "kfsp-rating-daily-7am-ict": "kfsp.rating_daily",
  "kfsp-ttai-history-daily-1am-ict": "kfsp.ttai_history",
  "sync-universe-5m": "market.sync_5m",
  "sync-universe-eod-1450": "market.sync_eod",
})

export const JOB_KEY_TO_PG_CRON_NAME: Readonly<Record<string, string>> = Object.freeze({
  "qeoindex.eod_pipeline": "qeoindex-eod-pipeline-1515-ict",
  "kfsp.rating_daily": "kfsp-rating-daily-7am-ict",
  "kfsp.ttai_history": "kfsp-ttai-history-daily-1am-ict",
  "market.sync_5m": "sync-universe-5m",
  "market.sync_eod": "sync-universe-eod-1450",
})

export function getJobKeyForPgCron(jobName: string): string | undefined {
  return PG_CRON_NAME_TO_JOB_KEY[jobName]
}

export function getPgCronNameForJobKey(jobKey: string): string | undefined {
  return JOB_KEY_TO_PG_CRON_NAME[jobKey]
}

export type TimelineLane = "vercel" | "pg_cron" | "manual"

export function getJobTimelineLane(job: { provider: string; scheduleKind?: string }): TimelineLane {
  if (job.scheduleKind === "manual" || job.provider === "machine") {
    return "manual"
  }
  if (job.provider.startsWith("vercel_cron")) {
    return "vercel"
  }
  return "pg_cron"
}

export interface ScheduleConflict {
  jobKey: string
  conflictWithKey: string
  timeIct: string
  days: string
  reason: string
  impact: "warning" | "error"
}

/**
 * Statically detects known operational schedule overlaps from job metadata.
 * Specifically detects the 14:50 ICT overlap between sync-universe-5m and sync-universe-eod-1450.
 */
export function findScheduleConflicts(jobs: (AdminJobDefinition | AdminJobView)[]): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = []
  const has5m = jobs.some((j) => j.key === "market.sync_5m")
  const hasEod1450 = jobs.some((j) => j.key === "market.sync_eod")

  if (has5m && hasEod1450) {
    conflicts.push({
      jobKey: "market.sync_5m",
      conflictWithKey: "market.sync_eod",
      timeIct: "14:50",
      days: "T2-T6 (Weekdays)",
      reason: "Trùng lịch chạy 14:50 ICT với Market EOD Sync (gây gọi kép orderbook-sync)",
      impact: "warning",
    })
    conflicts.push({
      jobKey: "market.sync_eod",
      conflictWithKey: "market.sync_5m",
      timeIct: "14:50",
      days: "T2-T6 (Weekdays)",
      reason: "Trùng lịch chạy 14:50 ICT với Market 5-Minute Sync (gây gọi kép orderbook-sync)",
      impact: "warning",
    })
  }

  return conflicts
}

export function getScheduleConflictWarning(jobKey: string, conflicts: ScheduleConflict[]): string | null {
  const conflict = conflicts.find((c) => c.jobKey === jobKey)
  return conflict ? conflict.reason : null
}
