import { sanitizeAdminValue } from "./redact.ts"
import { getJobKeyForPgCron } from "./job-schedule.ts"
import type {
  AdminJobDefinition,
  AdminJobStatus,
  AdminSchedulerStatus,
} from "./types.ts"

export interface SystemJobRunRow {
  id: string
  job_key: string
  provider?: string
  trigger: string
  status: string
  started_at: string
  finished_at?: string | null
  duration_ms?: number | null
  actor_user_id?: string | null
  request_id?: string | null
  summary?: Record<string, unknown> | null
  error_code?: string | null
  error_message?: string | null
  created_at?: string
}

export interface CronSnapshotRow {
  jobId: number
  jobName: string
  schedule: string
  active: boolean
  lastStatus: string | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
}

export interface KfspRatingRunEvidence {
  id: string
  as_of_date: string
  status: string
  published_row_count: number
  staged_row_count: number
  error_code: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export interface KfspTtaiRunEvidence {
  id: string
  status: string
  latest_rating_date: string | null
  candidate_count: number
  processed_count: number
  failed_count: number
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export interface OrderbookStatsEvidence {
  latestSessionDate: string | null
  totalSnapshots: number
  latestUpdatedAt: string | null
}

export interface RawEvidenceSnapshot {
  systemJobRuns: SystemJobRunRow[]
  cronSnapshots: CronSnapshotRow[]
  kfspRatingRuns: KfspRatingRunEvidence[]
  kfspTtaiRuns: KfspTtaiRunEvidence[]
  orderbookStats: OrderbookStatsEvidence | null
}

export interface ResolvedJobEvidence {
  executionStatus: AdminJobStatus
  schedulerStatus: AdminSchedulerStatus
  schedulerLastStatus: string | null
  schedulerLastStartedAt: string | null
  schedulerLastFinishedAt: string | null
  healthReason: string
  lastRunId: string | null
  lastTrigger: string | null
  lastStartedAt: string | null
  lastFinishedAt: string | null
  lastDurationMs: number | null
  lastSummary: Record<string, unknown> | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export function deriveBasicJobStatus(
  definition: AdminJobDefinition,
  latestRun: { status: string; startedAt?: string | null; finishedAt?: string | null } | null,
  now: Date = new Date(),
): AdminJobStatus {
  if (!latestRun || typeof latestRun.status !== "string") {
    return "unknown"
  }

  const status = latestRun.status.toLowerCase()
  const currentTime = now.getTime()

  if (status === "failed") {
    return "failing"
  }

  if (status === "skipped" || status === "partial") {
    return "degraded"
  }

  if (status === "running" || status === "queued") {
    if (latestRun.startedAt) {
      const started = new Date(latestRun.startedAt).getTime()
      if (Number.isFinite(started) && currentTime - started > definition.maxDurationMinutes * 60_000) {
        return "stale"
      }
    }
    return "healthy"
  }

  if (status === "succeeded" || status === "success" || status === "completed") {
    const completedStr = latestRun.finishedAt || latestRun.startedAt
    if (completedStr) {
      const completed = new Date(completedStr).getTime()
      if (Number.isFinite(completed) && currentTime - completed > definition.freshnessMinutes * 60_000) {
        return "stale"
      }
    }
    return "healthy"
  }

  return "unknown"
}

export interface VietnamMarketSessionState {
  dateKey: string // YYYY-MM-DD
  isWeekday: boolean
  isOpen: boolean // true if Mon-Fri between 09:00 and 15:00 ICT
  minutesSinceMidnight: number
}

export function getVietnamMarketSessionState(now: Date): VietnamMarketSessionState {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(now)

  const val = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  const dateKey = `${val("year")}-${val("month")}-${val("day")}`
  const weekday = val("weekday")
  const hour = Number(val("hour") || 0)
  const minute = Number(val("minute") || 0)
  const minutesSinceMidnight = hour * 60 + minute

  const isWeekday = weekday !== "Sat" && weekday !== "Sun"
  // Market active trading session: 09:00 to 15:00 ICT (540 to 900 minutes)
  const isOpen = isWeekday && minutesSinceMidnight >= 9 * 60 && minutesSinceMidnight <= 15 * 60

  return {
    dateKey,
    isWeekday,
    isOpen,
    minutesSinceMidnight,
  }
}

export function resolveJobEvidence(
  def: AdminJobDefinition,
  raw: RawEvidenceSnapshot,
  now: Date = new Date(),
): ResolvedJobEvidence {
  const currentTime = now.getTime()

  // 1. Resolve Scheduler Status
  let schedulerStatus: AdminSchedulerStatus = "unknown"
  let schedulerLastStatus: string | null = null
  let schedulerLastStartedAt: string | null = null
  let schedulerLastFinishedAt: string | null = null

  if (def.scheduleKind === "manual" || def.provider === "machine") {
    schedulerStatus = "unscheduled"
  } else if (def.provider.startsWith("vercel_cron")) {
    schedulerStatus = "active"
  }

  const targetSchedulerName = def.schedulerName || def.key
  const matchedCron = raw.cronSnapshots.find(
    (c) => c.jobName === targetSchedulerName || getJobKeyForPgCron(c.jobName) === def.key,
  )

  if (matchedCron) {
    schedulerStatus = matchedCron.active ? "active" : "inactive"
    schedulerLastStatus = matchedCron.lastStatus
    schedulerLastStartedAt = matchedCron.lastStartedAt
    schedulerLastFinishedAt = matchedCron.lastFinishedAt
  }

  // 2. Resolve Execution Health from Canonical Evidence
  let executionStatus: AdminJobStatus = "unknown"
  let healthReason = "Chưa ghi nhận dữ liệu thực thi"
  let lastRunId: string | null = null
  let lastTrigger: string | null = matchedCron ? "cron" : null
  let lastStartedAt: string | null = null
  let lastFinishedAt: string | null = null
  let lastDurationMs: number | null = null
  let lastSummary: Record<string, unknown> | null = null
  let lastErrorCode: string | null = null
  let lastErrorMessage: string | null = null

  // Special Adapter: KFSP Rating Daily Sync
  if (def.key === "kfsp.rating_daily" && raw.kfspRatingRuns.length > 0) {
    const run = raw.kfspRatingRuns[0]
    lastRunId = run.id
    lastStartedAt = run.started_at
    lastFinishedAt = run.completed_at
    lastTrigger = "cron"
    lastSummary = sanitizeAdminValue({
      as_of_date: run.as_of_date,
      published_rows: run.published_row_count,
      staged_rows: run.staged_row_count,
    }) as Record<string, unknown>
    lastErrorCode = run.error_code
    lastErrorMessage = run.error_message

    if (run.status === "completed") {
      if (run.published_row_count > 0) {
        const completedTime = run.completed_at ? new Date(run.completed_at).getTime() : new Date(run.started_at).getTime()
        if (Number.isFinite(completedTime) && currentTime - completedTime > def.freshnessMinutes * 60_000) {
          executionStatus = "stale"
          healthReason = `Dữ liệu ngày ${run.as_of_date} (${run.published_row_count} mã) đã quá hạn độ tươi`
        } else {
          executionStatus = "healthy"
          healthReason = `Đã công bố ${run.published_row_count} mã cho phiên ${run.as_of_date}`
        }
      } else {
        executionStatus = "degraded"
        healthReason = `Đồng bộ hoàn tất nhưng không có mã nào được công bố (${run.as_of_date})`
      }
    } else if (run.status === "failed") {
      executionStatus = "failing"
      healthReason = `Đồng bộ thất bại: ${run.error_message || run.error_code || "Lỗi đồng bộ KFSP"}`
    } else if (run.status === "running") {
      const startedTime = new Date(run.started_at).getTime()
      if (Number.isFinite(startedTime) && currentTime - startedTime > def.maxDurationMinutes * 60_000) {
        executionStatus = "stale"
        healthReason = `Đang chạy nhưng vượt quá thời lượng tối đa (${def.maxDurationMinutes}p)`
      } else {
        executionStatus = "healthy"
        healthReason = "Đang trong quá trình đồng bộ dữ liệu"
      }
    }

    return {
      executionStatus,
      schedulerStatus,
      schedulerLastStatus,
      schedulerLastStartedAt,
      schedulerLastFinishedAt,
      healthReason,
      lastRunId,
      lastTrigger,
      lastStartedAt,
      lastFinishedAt,
      lastDurationMs,
      lastSummary,
      lastErrorCode,
      lastErrorMessage,
    }
  }

  // Special Adapter: KFSP TTAI History Daily
  if (def.key === "kfsp.ttai_history" && raw.kfspTtaiRuns.length > 0) {
    const run = raw.kfspTtaiRuns[0]
    lastRunId = run.id
    lastStartedAt = run.started_at
    lastFinishedAt = run.completed_at
    lastTrigger = "cron"
    lastSummary = sanitizeAdminValue({
      candidate_count: run.candidate_count,
      processed_count: run.processed_count,
      failed_count: run.failed_count,
      latest_rating_date: run.latest_rating_date,
    }) as Record<string, unknown>
    lastErrorMessage = run.error_message

    if (run.status === "failed" || (run.failed_count > 0 && run.processed_count === 0)) {
      executionStatus = "failing"
      healthReason = `Thất bại: 0/${run.candidate_count || 12} mã (${run.failed_count || 12} lỗi, HTTP 207)`
    } else if (run.status === "completed" && run.failed_count === 0) {
      const completedTime = run.completed_at ? new Date(run.completed_at).getTime() : new Date(run.started_at).getTime()
      if (Number.isFinite(completedTime) && currentTime - completedTime > def.freshnessMinutes * 60_000) {
        executionStatus = "stale"
        healthReason = `Quá thời hạn kiểm tra độ tươi (${def.freshnessMinutes}p)`
      } else {
        executionStatus = "healthy"
        healthReason = `Đã xử lý thành công ${run.processed_count} mã`
      }
    } else if (run.status === "completed" && run.failed_count > 0) {
      executionStatus = "degraded"
      healthReason = `Xử lý một phần: ${run.processed_count} thành công, ${run.failed_count} lỗi`
    } else if (run.status === "running") {
      executionStatus = "healthy"
      healthReason = "Đang cập nhật lịch sử TTAI"
    }

    return {
      executionStatus,
      schedulerStatus,
      schedulerLastStatus,
      schedulerLastStartedAt,
      schedulerLastFinishedAt,
      healthReason,
      lastRunId,
      lastTrigger,
      lastStartedAt,
      lastFinishedAt,
      lastDurationMs,
      lastSummary,
      lastErrorCode,
      lastErrorMessage,
    }
  }

  // Special Adapter: Market 5m Sync / Market EOD Sync
  if ((def.key === "market.sync_5m" || def.key === "market.sync_eod") && raw.orderbookStats && raw.orderbookStats.totalSnapshots > 0) {
    const stats = raw.orderbookStats
    lastStartedAt = stats.latestUpdatedAt
    lastFinishedAt = stats.latestUpdatedAt
    lastTrigger = "cron"
    lastSummary = sanitizeAdminValue({
      session_date: stats.latestSessionDate,
      total_snapshots: stats.totalSnapshots,
    }) as Record<string, unknown>

    const sessionState = getVietnamMarketSessionState(now)

    if (!stats.latestUpdatedAt) {
      executionStatus = "unknown"
      healthReason = "Chưa có mốc thời gian cập nhật snapshot sổ lệnh"
    } else {
      const updatedTime = new Date(stats.latestUpdatedAt).getTime()
      if (!Number.isFinite(updatedTime)) {
        executionStatus = "unknown"
        healthReason = "Mốc thời gian cập nhật snapshot không hợp lệ"
      } else {
        const ageMs = currentTime - updatedTime
        const ageMinutes = Math.round(ageMs / 60_000)
        const isAdequate = stats.totalSnapshots >= 50

        if (def.key === "market.sync_5m") {
          if (sessionState.isOpen) {
            // Market is actively trading (09:00-15:00 ICT Mon-Fri)
            if (stats.latestSessionDate !== sessionState.dateKey) {
              executionStatus = "stale"
              healthReason = `Chưa có snapshot cho phiên đang mở (${sessionState.dateKey}), dữ liệu từ ${stats.latestSessionDate}`
            } else if (ageMs > def.freshnessMinutes * 60_000) {
              executionStatus = "stale"
              healthReason = `Snapshot sổ lệnh phiên hôm nay đã quá hạn (${ageMinutes}p trước, ngưỡng ${def.freshnessMinutes}p)`
            } else if (!isAdequate) {
              executionStatus = "degraded"
              healthReason = `Snapshot không đầy đủ: ${stats.totalSnapshots}/100 mã (${stats.latestSessionDate})`
            } else {
              executionStatus = "healthy"
              healthReason = `${stats.totalSnapshots}/100 snapshot sổ lệnh cho phiên ${stats.latestSessionDate}`
            }
          } else {
            // Market is closed (evening, night, weekend)
            // Off-session freshness allowance: 74 hours over weekend, 26 hours on weekdays
            const offSessionMaxAgeMs = !sessionState.isWeekday ? 74 * 3600_000 : 26 * 3600_000
            if (ageMs > offSessionMaxAgeMs) {
              executionStatus = "stale"
              healthReason = `Snapshot sổ lệnh phiên ${stats.latestSessionDate} đã quá cũ (${Math.round(ageMs / 3600_000)}h trước)`
            } else if (!isAdequate) {
              executionStatus = "degraded"
              healthReason = `Snapshot không đầy đủ: ${stats.totalSnapshots}/100 mã (${stats.latestSessionDate})`
            } else {
              executionStatus = "healthy"
              healthReason = `Phiên ${stats.latestSessionDate} đã đóng (${stats.totalSnapshots}/100 snapshot)`
            }
          }
        } else {
          // market.sync_eod (14:50 ICT Mon-Fri, freshness 26h / 74h weekend)
          const eodMaxAgeMs = !sessionState.isWeekday ? 74 * 3600_000 : def.freshnessMinutes * 60_000
          if (sessionState.isWeekday && sessionState.minutesSinceMidnight >= 14 * 60 + 55 && stats.latestSessionDate !== sessionState.dateKey) {
            executionStatus = "stale"
            healthReason = `Chưa có EOD snapshot cho phiên hôm nay (${sessionState.dateKey}), dữ liệu từ ${stats.latestSessionDate}`
          } else if (ageMs > eodMaxAgeMs) {
            executionStatus = "stale"
            healthReason = `Snapshot sổ lệnh EOD phiên ${stats.latestSessionDate} đã quá cũ (${Math.round(ageMs / 3600_000)}h trước)`
          } else if (!isAdequate) {
            executionStatus = "degraded"
            healthReason = `Snapshot EOD không đầy đủ: ${stats.totalSnapshots}/100 mã (${stats.latestSessionDate})`
          } else {
            executionStatus = "healthy"
            healthReason = `${stats.totalSnapshots}/100 snapshot sổ lệnh EOD cho phiên ${stats.latestSessionDate}`
          }
        }
      }
    }

    return {
      executionStatus,
      schedulerStatus,
      schedulerLastStatus,
      schedulerLastStartedAt,
      schedulerLastFinishedAt,
      healthReason,
      lastRunId,
      lastTrigger,
      lastStartedAt,
      lastFinishedAt,
      lastDurationMs,
      lastSummary,
      lastErrorCode,
      lastErrorMessage,
    }
  }

  // Standard Adapter: System Job Runs (EOD Pipeline, Signals Daily, Manual Jobs)
  const matchingRun = raw.systemJobRuns.find((r) => r.job_key === def.key)

  if (matchingRun) {
    executionStatus = deriveBasicJobStatus(
      def,
      {
        status: matchingRun.status,
        startedAt: matchingRun.started_at,
        finishedAt: matchingRun.finished_at,
      },
      now,
    )
    lastRunId = matchingRun.id
    lastTrigger = matchingRun.trigger
    lastStartedAt = matchingRun.started_at
    lastFinishedAt = matchingRun.finished_at ?? null
    lastDurationMs = matchingRun.duration_ms ?? null
    lastSummary = sanitizeAdminValue(matchingRun.summary) as Record<string, unknown> | null
    lastErrorCode = matchingRun.error_code ?? null
    lastErrorMessage = matchingRun.error_message ?? null

    if (matchingRun.status === "succeeded") {
      healthReason = executionStatus === "stale"
        ? `Lần chạy thành công gần nhất đã quá hạn độ tươi`
        : "Lần chạy gần nhất hoàn tất thành công"
    } else if (matchingRun.status === "failed") {
      healthReason = `Thất bại: ${matchingRun.error_message || matchingRun.error_code || "Lỗi thực thi"}`
    } else if (matchingRun.status === "running") {
      healthReason = executionStatus === "stale" ? "Tác vụ chạy quá thời gian tối đa" : "Đang thực thi"
    } else if (matchingRun.status === "skipped") {
      healthReason = "Lần chạy gần nhất được đánh dấu bỏ qua"
    }
  } else {
    executionStatus = "unknown"
    if (def.key === "qeoindex.eod_pipeline") {
      healthReason = "Chưa ghi nhận lần chạy nào (chờ lượt chạy đầu tiên lúc 15:15 ICT)"
    } else if (def.key === "signals.daily") {
      healthReason = "Chưa ghi nhận telemetry hoàn tất workflow (chờ hoàn tất lúc 07:00 ICT)"
    } else {
      healthReason = "Chưa có lượt chạy nào được ghi nhận trong telemetry"
    }
  }

  return {
    executionStatus,
    schedulerStatus,
    schedulerLastStatus,
    schedulerLastStartedAt,
    schedulerLastFinishedAt,
    healthReason,
    lastRunId,
    lastTrigger,
    lastStartedAt,
    lastFinishedAt,
    lastDurationMs,
    lastSummary,
    lastErrorCode,
    lastErrorMessage,
  }
}
