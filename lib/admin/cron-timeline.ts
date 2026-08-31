import { getJobTimelineLane, getPgCronNameForJobKey } from "./job-schedule.ts"
import type { AdminJobView, AdminJobStatus, AdminSchedulerStatus, AdminJobEvidenceSource } from "./types.ts"

export interface TimelinePhaseItem {
  key: string
  label: string
  order: number
}

export const EOD_PIPELINE_PHASES: TimelinePhaseItem[] = [
  { key: "EOD_READY", label: "1. EOD Ready", order: 1 },
  { key: "HISTORY_REFRESH", label: "2. History Cache", order: 2 },
  { key: "WYCKOFF_BUILD", label: "3. Wyckoff 500", order: 3 },
  { key: "NOTION_STAGING", label: "4. Notion Staging", order: 4 },
  { key: "NOTION_VALIDATE", label: "5. Validate & Hash", order: 5 },
  { key: "INGEST", label: "6. Claim Ingest", order: 6 },
  { key: "SUPABASE_PUBLISH", label: "7. Publish DB", order: 7 },
  { key: "AI_COUNCIL_DETERMINISTIC", label: "8. Council Rules", order: 8 },
  { key: "AI_COUNCIL_LLM", label: "9. LLM Debate", order: 9 },
  { key: "COMPLETE", label: "10. Complete", order: 10 },
]

export interface TimelineJobNode {
  key: string
  label: string
  description: string
  provider: string
  schedulerName?: string
  lane: "vercel" | "pg_cron" | "manual"
  displayType: "point" | "interval" | "recurring_point" | "manual"
  timeIctLabel: string
  daysLabel: "T2-T6" | "Hàng ngày" | "Thủ công"
  startMinuteOfDay?: number
  endMinuteOfDay?: number
  startPercent?: number
  endPercent?: number
  executionStatus: AdminJobStatus
  schedulerStatus: AdminSchedulerStatus
  schedulerEvidence?: AdminJobView["schedulerEvidence"]
  schedulerLastStatus: string | null
  healthReason: string
  conflictWarning: string | null
  evidenceSource: AdminJobEvidenceSource
  phases?: TimelinePhaseItem[]
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
  lastDurationMs?: number | null
}

export interface TimelineLaneGroup {
  id: "vercel" | "pg_cron" | "manual"
  title: string
  description: string
  jobs: TimelineJobNode[]
}

export interface CronTimelineModel {
  lanes: TimelineLaneGroup[]
  allNodes: TimelineJobNode[]
  totalScheduled: number
  totalManual: number
  healthyCount: number
  failingCount: number
  unknownCount: number
  conflictCount: number
}

function formatMinute(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

function minuteToPercent(minutes: number): number {
  return Math.min(100, Math.max(0, (minutes / (24 * 60)) * 100))
}

export function buildCronTimelineModel(jobs: AdminJobView[]): CronTimelineModel {
  const allNodes: TimelineJobNode[] = jobs.map((job) => {
    let lane: TimelineJobNode["lane"] = "manual"
    let displayType: TimelineJobNode["displayType"] = "manual"
    let timeIctLabel = job.scheduleIct || "Thủ công"
    let daysLabel: TimelineJobNode["daysLabel"] = "Thủ công"
    let startMinuteOfDay: number | undefined
    let endMinuteOfDay: number | undefined
    let startPercent: number | undefined
    let endPercent: number | undefined
    let phases: TimelinePhaseItem[] | undefined

    const policy = job.schedulePolicy
    lane = getJobTimelineLane(job)
    if (!policy || policy.kind === "manual") {
      lane = "manual"
      displayType = "manual"
      timeIctLabel = "Thủ công"
      daysLabel = "Thủ công"
    } else if (policy.kind === "fixed_time") {
      displayType = job.key === "qeoindex.eod_pipeline" ? "point" : "point"
      const minute = policy.minuteOfDay
      timeIctLabel = `${formatMinute(minute)} ICT`
      daysLabel = policy.cadence === "weekdays" ? "T2-T6" : "Hàng ngày"
      startMinuteOfDay = minute
      startPercent = minuteToPercent(minute)
      if (job.key === "qeoindex.eod_pipeline") phases = EOD_PIPELINE_PHASES
    } else {
      displayType = "interval"
      const first = policy.windows[0]
      const last = policy.windows[policy.windows.length - 1]
      timeIctLabel = `${formatMinute(first.startMinuteOfDay)} – ${formatMinute(last.endMinuteOfDay)} (mỗi ${first.cadenceMinutes}p)`
      daysLabel = policy.cadence === "weekdays" ? "T2-T6" : "Hàng ngày"
      startMinuteOfDay = first.startMinuteOfDay
      endMinuteOfDay = last.endMinuteOfDay
      startPercent = minuteToPercent(startMinuteOfDay)
      endPercent = minuteToPercent(endMinuteOfDay)
    }

    const schedulerName = job.schedulerName || getPgCronNameForJobKey(job.key)

    return {
      key: job.key,
      label: job.label,
      description: job.description,
      provider: job.provider,
      schedulerName,
      lane,
      displayType,
      timeIctLabel,
      daysLabel,
      startMinuteOfDay,
      endMinuteOfDay,
      startPercent,
      endPercent,
      executionStatus: job.status,
      schedulerStatus: job.schedulerStatus ?? "unknown",
      schedulerEvidence: job.schedulerEvidence,
      schedulerLastStatus: job.schedulerLastStatus ?? null,
      healthReason: job.healthReason || "Không có ghi chú thực thi",
      conflictWarning: job.conflictWarning ?? null,
      evidenceSource: job.evidenceSource ?? "system_job_runs",
      phases,
      lastStartedAt: job.lastStartedAt,
      lastFinishedAt: job.lastFinishedAt,
      lastDurationMs: job.lastDurationMs,
    }
  })

  const vercelJobs = allNodes.filter((n) => n.lane === "vercel")
  const pgCronJobs = allNodes.filter((n) => n.lane === "pg_cron").sort((a, b) => {
    const minA = a.startMinuteOfDay ?? 9999
    const minB = b.startMinuteOfDay ?? 9999
    return minA - minB
  })
  const manualJobs = allNodes.filter((n) => n.lane === "manual")

  const lanes: TimelineLaneGroup[] = [
    {
      id: "vercel",
      title: "Vercel Cron & Durable Workflow",
      description: "Tác vụ chạy qua Vercel Cloud Serverless và Durable Workflow Engine.",
      jobs: vercelJobs,
    },
    {
      id: "pg_cron",
      title: "Supabase pg_cron & Edge Functions",
      description: "Lịch cron cấp cơ sở dữ liệu Supabase kích hoạt Edge Functions và EOD pipeline.",
      jobs: pgCronJobs,
    },
    {
      id: "manual",
      title: "Tác vụ Thủ công & Hệ thống (Allowlist)",
      description: "Các tác vụ on-demand kích hoạt trực tiếp từ Control Plane với quyền Root Admin.",
      jobs: manualJobs,
    },
  ]

  const totalScheduled = vercelJobs.length + pgCronJobs.length
  const totalManual = manualJobs.length
  const healthyCount = allNodes.filter((n) => n.executionStatus === "healthy").length
  const failingCount = allNodes.filter((n) => n.executionStatus === "failing").length
  const unknownCount = allNodes.filter((n) => n.executionStatus === "unknown").length
  const conflictCount = allNodes.filter((n) => Boolean(n.conflictWarning)).length

  return {
    lanes,
    allNodes,
    totalScheduled,
    totalManual,
    healthyCount,
    failingCount,
    unknownCount,
    conflictCount,
  }
}
