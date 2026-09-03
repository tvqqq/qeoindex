import { getJobTimelineLane, getPgCronNameForJobKey } from "./job-schedule.ts"
import type {
  AdminJobEvidenceSource,
  AdminJobStatus,
  AdminJobView,
  AdminManualPolicy,
  AdminManualPurpose,
  AdminSchedulerStatus,
} from "./types.ts"

export interface TimelinePhaseItem {
  key: string
  label: string
  order: number
}

export const EOD_PIPELINE_PHASES: TimelinePhaseItem[] = [
  { key: "EOD_READY", label: "1. EOD Ready", order: 1 },
  { key: "MARKET_CLOSE_COLLECT", label: "2. Market Close", order: 2 },
  { key: "HISTORY_REFRESH", label: "3. History Refresh", order: 3 },
  { key: "WYCKOFF_BUILD", label: "4. Wyckoff Build", order: 4 },
  { key: "SUPABASE_VALIDATE", label: "5. Supabase Validate", order: 5 },
  { key: "SUPABASE_PUBLISH", label: "6. Supabase Publish", order: 6 },
  { key: "AI_COUNCIL_DETERMINISTIC", label: "7. Council Rules", order: 7 },
  { key: "AI_COUNCIL_LLM", label: "8. LLM Debate", order: 8 },
  { key: "MARKET_SYNTHESIS", label: "9. Market Synthesis", order: 9 },
  { key: "NOTION_ARCHIVE", label: "10. Notion Archive", order: 10 },
  { key: "DRIVE_ARCHIVE", label: "11. Drive Archive", order: 11 },
  { key: "RETENTION_CLEANUP", label: "12. Retention", order: 12 },
  { key: "COMPLETE", label: "13. Complete", order: 13 },
]

export type TimelineLaneId = "vercel" | "pg_cron" | "manual" | "disabled"

export interface TimelineJobNode {
  key: string
  label: string
  description: string
  provider: string
  schedulerName?: string
  lane: TimelineLaneId
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
  manualPolicy: AdminManualPolicy
  manualPurpose?: AdminManualPurpose
  automatedParentKeys?: string[]
  phases?: TimelinePhaseItem[]
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
  lastDurationMs?: number | null
}

export interface TimelineLaneGroup {
  id: TimelineLaneId
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

function manualContextDescription(node: TimelineJobNode) {
  if (node.manualPurpose === "recovery") {
    if (node.automatedParentKeys?.length) {
      return `${node.description} Manual recovery · Automated by: ${node.automatedParentKeys.join(", ")}.`
    }
    if (node.lane === "vercel" || node.lane === "pg_cron") {
      return `${node.description} Manual recovery của scheduled job ${node.key}.`
    }
    return `${node.description} Manual recovery one-shot.`
  }
  if (node.manualPurpose === "diagnostic") {
    return `${node.description} Manual diagnostic action.`
  }
  return `${node.description} Manual maintenance action.`
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
      lane = job.manualPolicy === "disabled" ? "disabled" : "manual"
      displayType = "manual"
      timeIctLabel = "Thủ công"
      daysLabel = "Thủ công"
    } else if (policy.kind === "fixed_time") {
      displayType = "point"
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
      const windowLabel = policy.windows
        .map((window) => `${formatMinute(window.startMinuteOfDay)}–${formatMinute(window.endMinuteOfDay)}`)
        .join(" / ")
      timeIctLabel = `${windowLabel} (mỗi ${first.cadenceMinutes}p)`
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
      manualPolicy: job.manualPolicy,
      manualPurpose: job.manualPurpose,
      automatedParentKeys: job.automatedParentKeys,
      phases,
      lastStartedAt: job.lastStartedAt,
      lastFinishedAt: job.lastFinishedAt,
      lastDurationMs: job.lastDurationMs,
    }
  })

  const vercelJobs = allNodes.filter((node) => node.lane === "vercel")
  const pgCronJobs = allNodes.filter((node) => node.lane === "pg_cron").sort((left, right) => {
    const minA = left.startMinuteOfDay ?? 9999
    const minB = right.startMinuteOfDay ?? 9999
    return minA - minB
  })
  const manualJobs = allNodes
    .filter((node) => node.manualPolicy !== "disabled")
    .map((node) => ({
      ...node,
      lane: "manual" as const,
      displayType: "manual" as const,
      description: manualContextDescription(node),
    }))
  const disabledJobs = allNodes.filter((node) => node.lane === "disabled")

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
      title: "Manual Recovery & Maintenance",
      description: "Các one-shot action được allowlist để recovery/diagnostic; chúng không thay thế scheduler tự động.",
      jobs: manualJobs,
    },
    {
      id: "disabled",
      title: "Manual Disabled / Legacy Maintenance",
      description: "Các action giữ lại để quan sát lịch sử nhưng bị policy chặn và không thể dispatch từ Control Plane.",
      jobs: disabledJobs,
    },
  ]

  const totalScheduled = vercelJobs.length + pgCronJobs.length
  const totalManual = manualJobs.length
  const healthyCount = allNodes.filter((node) => node.executionStatus === "healthy").length
  const failingCount = allNodes.filter((node) => node.executionStatus === "failing").length
  const unknownCount = allNodes.filter((node) => node.executionStatus === "unknown").length
  const conflictCount = allNodes.filter((node) => Boolean(node.conflictWarning)).length

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
