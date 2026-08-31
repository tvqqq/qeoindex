import type { AiCouncilLlmUsageRow } from "./job-ai-usage.ts"
import { sanitizeAdminValue } from "./redact.ts"
import { getJobKeyForPgCron } from "./job-schedule.ts"
import { interpretEodQuality, interpretRatingQuality, interpretSignalsDailyQuality, interpretTtaiQuality } from "./job-quality.ts"
import type { SchedulerReconciliation } from "./scheduler-reconciliation.ts"
import type {
  AdminJobDefinition,
  AdminJobView,
  AdminExecutionEvidence,
  AdminTerminalExecutionEvidence,
  AdminJobStatus,
  AdminSchedulerStatus,
  SchedulePolicy,
  SchedulerReconciliationView,
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
  aiCouncilLlmDebates?: AiCouncilLlmUsageRow[]
  schedulerReconciliation?: SchedulerReconciliation
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
  currentExecution: AdminExecutionEvidence | null
  lastTerminalExecution: AdminTerminalExecutionEvidence | null
  domainEvidence: Record<string, unknown> | null
  executionTelemetry: Record<string, unknown> | null
  scheduleDueState: "not_due" | "due" | "overdue" | "unknown"
  schedulerEvidence: NonNullable<AdminJobView["schedulerEvidence"]>
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
    return "in_progress"
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
  dateKey: string
  isWeekday: boolean
  isOpen: boolean
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
  const isOpen = isWeekday && minutesSinceMidnight >= 9 * 60 && minutesSinceMidnight <= 15 * 60

  return {
    dateKey,
    isWeekday,
    isOpen,
    minutesSinceMidnight,
  }
}

function ictDateAndMinute(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(value)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  return { date: `${pick("year")}-${pick("month")}-${pick("day")}`, minute: Number(pick("hour")) * 60 + Number(pick("minute")) }
}

export function deriveScheduleDueState(policy: SchedulePolicy | undefined, lastTerminalFinishedAt: string | null, now: Date = new Date()): "not_due" | "due" | "overdue" | "unknown" {
  if (!policy || policy.kind === "manual") return "not_due"
  const current = ictDateAndMinute(now)
  const weekday = new Date(`${current.date}T12:00:00Z`).getUTCDay()
  if (policy.cadence === "weekdays" && (weekday === 0 || weekday === 6)) return "not_due"
  const terminal = lastTerminalFinishedAt ? new Date(lastTerminalFinishedAt) : null
  const terminalParts = terminal && Number.isFinite(terminal.getTime()) ? ictDateAndMinute(terminal) : null

  if (policy.kind === "fixed_time") {
    const deadline = policy.completionDeadlineMinuteOfDay ?? policy.minuteOfDay + policy.graceMinutes
    if (current.minute < policy.minuteOfDay) return "not_due"
    if (terminalParts?.date === current.date && terminalParts.minute >= policy.minuteOfDay) return "due"
    return current.minute > deadline + policy.graceMinutes ? "overdue" : "due"
  }

  const active = policy.windows.some((window) => current.minute >= window.startMinuteOfDay && current.minute <= window.endMinuteOfDay)
  if (active) return "due"
  const lastWindow = policy.windows[policy.windows.length - 1]
  if (current.minute < policy.windows[0].startMinuteOfDay) return "not_due"
  if (terminalParts?.date === current.date && terminalParts.minute >= lastWindow.endMinuteOfDay) return "due"
  return current.minute > lastWindow.endMinuteOfDay + policy.graceMinutes ? "overdue" : "due"
}

function cronTimestamp(row: CronSnapshotRow) {
  const value = row.lastStartedAt || row.lastFinishedAt
  if (!value) return Number.NEGATIVE_INFINITY
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY
}

function latestMatchingCron(def: AdminJobDefinition, rows: CronSnapshotRow[]) {
  const targetSchedulerName = def.schedulerName || def.key
  return rows
    .filter((row) => row.jobName === targetSchedulerName || getJobKeyForPgCron(row.jobName) === def.key)
    .sort((a, b) => cronTimestamp(b) - cronTimestamp(a))[0]
}

function elapsedDurationMs(startedAt: string | null, finishedAt: string | null) {
  if (!startedAt || !finishedAt) return null
  const started = new Date(startedAt).getTime()
  const finished = new Date(finishedAt).getTime()
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null
  return finished - started
}

function summaryObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function summaryNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function resolveJobEvidence(
  def: AdminJobDefinition,
  raw: RawEvidenceSnapshot,
  now: Date = new Date(),
): ResolvedJobEvidence {
  const currentTime = now.getTime()

  let schedulerStatus: AdminSchedulerStatus = "unknown"
  let schedulerLastStatus: string | null = null
  let schedulerLastStartedAt: string | null = null
  let schedulerLastFinishedAt: string | null = null

  if (def.scheduleKind === "manual" || def.provider === "machine") {
    schedulerStatus = "unscheduled"
  } else if (def.provider.startsWith("vercel_cron")) {
    schedulerStatus = "active"
  }

  const matchedCron = latestMatchingCron(def, raw.cronSnapshots)
  const schedulerMapping = raw.schedulerReconciliation?.mappings.find((mapping) => mapping.jobKey === def.key && mapping.schedulerName === def.schedulerName)
  const logicalScheduler = raw.schedulerReconciliation?.logical.find((mapping) => mapping.jobKey === def.key)

  if (raw.schedulerReconciliation) {
    if (schedulerMapping?.status === "live_verified") {
      schedulerStatus = matchedCron?.active ? "active" : "inactive"
      schedulerLastStatus = matchedCron?.lastStatus ?? null
      schedulerLastStartedAt = matchedCron?.lastStartedAt ?? null
      schedulerLastFinishedAt = matchedCron?.lastFinishedAt ?? null
    } else if (schedulerMapping?.status === "inactive") {
      schedulerStatus = "inactive"
    }
  } else if (matchedCron) {
    schedulerStatus = matchedCron.active ? "active" : "inactive"
    schedulerLastStatus = matchedCron.lastStatus
    schedulerLastStartedAt = matchedCron.lastStartedAt
    schedulerLastFinishedAt = matchedCron.lastFinishedAt
  }

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
  const matchingRuns = raw.systemJobRuns.filter((run) => run.job_key === def.key)
  const currentRun = matchingRuns.find((run) => run.status === "running" || run.status === "queued")
  const terminalRun = matchingRuns.find((run) => !["running", "queued"].includes(run.status))
  const currentExecution: AdminExecutionEvidence | null = currentRun
    ? { status: currentRun.status as "queued" | "running", startedAt: currentRun.started_at ?? null, runId: currentRun.id }
    : null
  const lastTerminalExecution: AdminTerminalExecutionEvidence | null = terminalRun
    ? { status: terminalRun.status, finishedAt: terminalRun.finished_at ?? null, runId: terminalRun.id }
    : null
  const scheduleDueState = deriveScheduleDueState(def.schedulePolicy, lastTerminalExecution?.finishedAt ?? null, now)
  let domainEvidence: Record<string, unknown> | null = null
  let executionTelemetry: Record<string, unknown> | null = null

  const evidenceResult = () => ({
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
    currentExecution,
    lastTerminalExecution,
    domainEvidence,
    executionTelemetry,
    scheduleDueState,
    schedulerEvidence: (raw.schedulerReconciliation
      ? raw.schedulerReconciliation.availability === "unavailable"
        ? { availability: "unavailable" as const, reason: raw.schedulerReconciliation.aggregate.unavailable ? "RPC unavailable" : "Invalid scheduler evidence" }
        : { availability: "available" as const, status: (logicalScheduler?.status ?? (def.provider.startsWith("vercel_cron") ? "config_only" : "missing")) as SchedulerReconciliationView["status"], children: raw.schedulerReconciliation.physicalMappings.filter((mapping) => mapping.jobKey === def.key).map((mapping) => ({ mappingId: mapping.mappingId, status: mapping.status })) }
      : { availability: "unavailable" as const, reason: "Scheduler evidence not loaded" }) as NonNullable<AdminJobView["schedulerEvidence"]>,
  })

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
    domainEvidence = { source: "kfsp_rating_sync_runs", asOfDate: run.as_of_date, publishedRows: run.published_row_count, quality: interpretRatingQuality({ staged: run.staged_row_count, published: run.published_row_count }) }
    executionTelemetry = matchedCron ? { source: "pg_cron", lastStatus: matchedCron.lastStatus } : { source: "unavailable" }

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
        executionStatus = "in_progress"
        healthReason = "Đang trong quá trình đồng bộ dữ liệu"
      }
    }

    if (executionStatus === "stale" && scheduleDueState !== "overdue" && !currentExecution) executionStatus = "healthy"

    return evidenceResult()
  }

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
    domainEvidence = { source: "kfsp_ttai_sync_runs", latestRatingDate: run.latest_rating_date, processed: run.processed_count, failed: run.failed_count, quality: interpretTtaiQuality({ candidates: run.candidate_count, processed: run.processed_count, failed: run.failed_count }) }
    executionTelemetry = matchedCron ? { source: "pg_cron", lastStatus: matchedCron.lastStatus } : { source: "unavailable" }

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
      executionStatus = "in_progress"
      healthReason = "Đang cập nhật lịch sử TTAI"
    }

    return evidenceResult()
  }

  if ((def.key === "market.sync_5m" || def.key === "market.sync_eod") && raw.orderbookStats && raw.orderbookStats.totalSnapshots > 0) {
    const stats = raw.orderbookStats
    lastStartedAt = matchedCron?.lastStartedAt ?? stats.latestUpdatedAt
    lastFinishedAt = matchedCron?.lastFinishedAt ?? stats.latestUpdatedAt
    lastTrigger = matchedCron ? "cron" : "evidence"
    lastSummary = sanitizeAdminValue({
      session_date: stats.latestSessionDate,
      total_snapshots: stats.totalSnapshots,
      evidence_updated_at: stats.latestUpdatedAt,
    }) as Record<string, unknown>
    domainEvidence = { source: "stock_orderbook_snapshots", sessionDate: stats.latestSessionDate, totalSnapshots: stats.totalSnapshots }
    executionTelemetry = matchedCron ? { source: "pg_cron", lastStatus: matchedCron.lastStatus } : { source: "unavailable", reason: "No execution telemetry recorded" }

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

    return evidenceResult()
  }

  const matchingRun = matchingRuns[0]
  const qualityRun = currentRun ? terminalRun : matchingRun

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
    lastDurationMs = matchingRun.duration_ms ?? elapsedDurationMs(lastStartedAt, lastFinishedAt)
    lastSummary = sanitizeAdminValue(matchingRun.summary) as Record<string, unknown> | null
    lastErrorCode = matchingRun.error_code ?? null
    lastErrorMessage = matchingRun.error_message ?? null
    executionTelemetry = { source: "system_job_runs", runId: matchingRun.id, status: matchingRun.status }

    const qualitySummary = summaryObject(qualityRun?.summary)
    if (def.key === "qeoindex.eod_pipeline" && qualitySummary) {
      const build = summaryObject(qualitySummary.build)
      const validation = summaryObject(qualitySummary.validation)
      const history = summaryObject(qualitySummary.history)
      const total = summaryNumber(build?.total ?? validation?.total)
      const complete = summaryNumber(build?.complete ?? validation?.complete)
      const incomplete = summaryNumber(build?.incomplete ?? validation?.incomplete)
      const validationAgreement = build && validation
        ? total !== null && complete !== null && incomplete !== null
          && total === summaryNumber(validation.total)
          && complete === summaryNumber(validation.complete)
          && incomplete === summaryNumber(validation.incomplete)
        : null
      if (total !== null && complete !== null && incomplete !== null && validationAgreement !== null) {
        domainEvidence = { source: "system_job_runs", quality: interpretEodQuality({ total, complete, incomplete, validationAgreement, limitedCoverageCount: history?.limitedCoverageCount }) }
      }
    } else if (def.key === "signals.daily" && qualitySummary) {
      const scanner = summaryObject(qualitySummary.scanner)
      if (scanner) domainEvidence = { source: "system_job_runs", quality: interpretSignalsDailyQuality({ completed: scanner.completed, errors: scanner.errors, skipped: scanner.skipped }) }
    }

    const isIdempotentEodNoop = def.key === "qeoindex.eod_pipeline"
      && matchingRun.status === "skipped"
      && lastSummary?.notionAction === "stop"
      && lastSummary?.marketCloseStatus === "succeeded"

    if (isIdempotentEodNoop) {
      executionStatus = deriveBasicJobStatus(
        def,
        { status: "succeeded", startedAt: lastStartedAt, finishedAt: lastFinishedAt },
        now,
      )
      const scanDate = typeof lastSummary?.scanDate === "string" ? lastSummary.scanDate : null
      healthReason = executionStatus === "stale"
        ? "Phiên đã hoàn tất nhưng invocation no-op gần nhất đã quá hạn độ tươi"
        : `Phiên${scanDate ? ` ${scanDate}` : ""} đã hoàn tất; invocation cuối là no-op idempotent`
    } else if (matchingRun.status === "succeeded") {
      const scanner = summaryObject(lastSummary?.scanner)
      const scannerErrors = scanner ? summaryNumber(scanner.errors) : 0
      const scannerCompleted = scanner ? summaryNumber(scanner.completed) : 0
      const scannerSkipped = scanner ? summaryNumber(scanner.skipped) : 0
      const scannerTotal = scannerCompleted + scannerSkipped + scannerErrors

      if (def.key === "signals.daily" && executionStatus === "healthy" && scannerErrors > 0) {
        executionStatus = "degraded"
        healthReason = `${scannerCompleted}/${scannerTotal || scannerCompleted + scannerErrors} mã scanner hoàn tất, ${scannerErrors} lỗi`
      } else {
        healthReason = executionStatus === "stale"
          ? "Lần chạy thành công gần nhất đã quá hạn độ tươi"
          : "Lần chạy gần nhất hoàn tất thành công"
      }
    } else if (matchingRun.status === "failed") {
      healthReason = `Thất bại: ${matchingRun.error_message || matchingRun.error_code || "Lỗi thực thi"}`
    } else if (matchingRun.status === "running") {
      healthReason = executionStatus === "stale" ? "Tác vụ chạy quá thời gian tối đa" : "Đang thực thi"
    } else if (matchingRun.status === "skipped") {
      healthReason = "Lần chạy gần nhất được đánh dấu bỏ qua"
    }
    const qualityStatus = (domainEvidence?.quality as { status?: string } | undefined)?.status
    if (matchingRun.status === "succeeded" && qualityStatus && ["partial_by_reported_counts", "reported_issues", "inconsistent"].includes(qualityStatus)) {
      executionStatus = "degraded"
      healthReason = (domainEvidence?.quality as { label?: string }).label || "Chất lượng dữ liệu cần kiểm tra"
    }
    if (executionStatus === "stale" && scheduleDueState !== "overdue" && !currentExecution) {
      executionStatus = "healthy"
      healthReason = "Bằng chứng terminal gần nhất còn hiệu lực; lịch kế tiếp chưa đến hạn"
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

  return evidenceResult()
}
