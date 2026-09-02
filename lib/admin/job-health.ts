import { aggregateAiCouncilUsage, type AiCouncilLlmUsageRow } from "./job-ai-usage.ts"
import { EFFECTIVE_ADMIN_JOB_CATALOG } from "./effective-job-catalog.ts"
import { sanitizeAdminValue } from "./redact.ts"
import { findScheduleConflicts, getScheduleConflictWarning } from "./job-schedule.ts"
import {
  deriveBasicJobStatus,
  resolveJobEvidence,
  type CronSnapshotRow,
  type KfspRatingRunEvidence,
  type KfspTtaiRunEvidence,
  type OrderbookStatsEvidence,
  type RawEvidenceSnapshot,
  type SystemJobRunRow,
} from "./job-evidence.ts"
import type {
  AdminJobDefinition,
  AdminJobStatus,
  AdminJobView,
  AdminSystemOverview,
} from "./types.ts"
import { reconcileSupabaseSchedulers } from "./scheduler-reconciliation.ts"

export type {
  CronSnapshotRow,
  KfspRatingRunEvidence,
  KfspTtaiRunEvidence,
  OrderbookStatsEvidence,
  RawEvidenceSnapshot,
  SystemJobRunRow,
}

export interface LatestRunSnapshot {
  status: string
  startedAt?: string | null
  finishedAt?: string | null
}

const JOB_HISTORY_RETENTION_DAYS = 7
const SYSTEM_JOB_RUN_COLUMNS = "id,job_key,provider,trigger,status,actor_user_id,started_at,finished_at,duration_ms,summary,error_code,error_message,created_at"

function getJobHistoryCutoff(now: Date = new Date()) {
  return new Date(now.getTime() - JOB_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

async function getSupabase() {
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  return getSupabaseServerClient()
}

export function deriveAdminJobStatus(
  definition: AdminJobDefinition,
  latestRun: LatestRunSnapshot | null,
  now: Date = new Date(),
): AdminJobStatus {
  return deriveBasicJobStatus(definition, latestRun, now)
}

export function buildAdminJobViews(
  catalog: AdminJobDefinition[],
  evidenceOrRuns: RawEvidenceSnapshot | SystemJobRunRow[],
  cronSnapshots: CronSnapshotRow[] = [],
  now: Date = new Date(),
): { jobs: AdminJobView[]; counts: AdminSystemOverview["jobCounts"]; scheduler: AdminSystemOverview["scheduler"] } {
  let rawEvidence: RawEvidenceSnapshot

  if (Array.isArray(evidenceOrRuns)) {
    rawEvidence = {
      systemJobRuns: evidenceOrRuns,
      cronSnapshots,
      kfspRatingRuns: [],
      kfspTtaiRuns: [],
      orderbookStats: null,
      aiCouncilLlmDebates: [],
      schedulerReconciliation: cronSnapshots.length > 0
        ? reconcileSupabaseSchedulers({ availability: "available", rows: cronSnapshots })
        : reconcileSupabaseSchedulers({ availability: "unavailable", reason: "rpc_error" }),
    }
  } else {
    rawEvidence = evidenceOrRuns
  }

  const conflicts = findScheduleConflicts(catalog)
  const aiUsageByDate = aggregateAiCouncilUsage(rawEvidence.aiCouncilLlmDebates ?? [])

  const counts: AdminSystemOverview["jobCounts"] = {
    total: catalog.length,
    healthy: 0,
    degraded: 0,
    failing: 0,
    stale: 0,
    in_progress: 0,
    unknown: 0,
  }

  const jobs: AdminJobView[] = catalog.map((def) => {
    const resolved = resolveJobEvidence(def, rawEvidence, now)
    const conflictWarning = getScheduleConflictWarning(def.key, conflicts)
    const status = resolved.executionStatus
    const scanDate = typeof resolved.lastSummary?.scanDate === "string" ? resolved.lastSummary.scanDate : null
    const aiUsage = def.key === "qeoindex.eod_pipeline" && scanDate ? aiUsageByDate[scanDate] ?? null : null

    counts[status] += 1

    return {
      key: def.key,
      provider: def.provider,
      label: def.label,
      description: def.description,
      group: def.group,
      scheduleUtc: def.scheduleUtc,
      scheduleIct: def.scheduleIct,
      scheduleKind: def.scheduleKind,
      schedulerName: def.schedulerName,
      scheduleDays: def.scheduleDays,
      windowStartIct: def.windowStartIct,
      windowEndIct: def.windowEndIct,
      intervalMinutes: def.intervalMinutes,
      dependencies: def.dependencies,
      manualPolicy: def.manualPolicy,
      status,
      schedulerStatus: resolved.schedulerStatus,
      schedulerLastStatus: resolved.schedulerLastStatus,
      schedulerLastStartedAt: resolved.schedulerLastStartedAt,
      schedulerLastFinishedAt: resolved.schedulerLastFinishedAt,
      executionStatus: status,
      evidenceSource: def.evidenceSource ?? "system_job_runs",
      healthReason: resolved.healthReason,
      conflictWarning,
      lastRunId: resolved.lastRunId,
      lastTrigger: resolved.lastTrigger,
      lastStartedAt: resolved.lastStartedAt,
      lastFinishedAt: resolved.lastFinishedAt,
      lastDurationMs: resolved.lastDurationMs,
      lastSummary: resolved.lastSummary,
      lastErrorCode: resolved.lastErrorCode,
      lastErrorMessage: resolved.lastErrorMessage,
      aiUsage,
      schedulePolicy: def.schedulePolicy,
      currentExecution: resolved.currentExecution,
      lastTerminalExecution: resolved.lastTerminalExecution,
      domainEvidence: resolved.domainEvidence,
      executionTelemetry: resolved.executionTelemetry,
      scheduleDueState: resolved.scheduleDueState,
      schedulerEvidence: resolved.schedulerEvidence,
    }
  })

  return { jobs, counts, scheduler: rawEvidence.schedulerReconciliation?.aggregate ?? { expected: 7, liveVerified: 0, configOnly: 1, missing: 0, drifted: 0, duplicated: 0, unavailable: 6, extraUnmapped: 0, inventoryClean: false, expectedMappingsVerified: false } }
}

export async function loadAdminJobsSnapshot(): Promise<{ jobs: AdminJobView[]; counts: AdminSystemOverview["jobCounts"]; scheduler: AdminSystemOverview["scheduler"] }> {
  const supabase = await getSupabase()
  if (!supabase) {
    return buildAdminJobViews(EFFECTIVE_ADMIN_JOB_CATALOG, [])
  }

  const historyCutoff = getJobHistoryCutoff()
  const rawEvidence: RawEvidenceSnapshot = {
    systemJobRuns: [],
    cronSnapshots: [],
    kfspRatingRuns: [],
    kfspTtaiRuns: [],
    orderbookStats: null,
    aiCouncilLlmDebates: [],
    schedulerReconciliation: reconcileSupabaseSchedulers({ availability: "unavailable", reason: "rpc_error" }),
  }

  const [runsResult, cronResult, ratingResult, ttaiResult, orderbookResult, aiUsageResult] = await Promise.allSettled([
    supabase
      .from("system_job_runs")
      .select(SYSTEM_JOB_RUN_COLUMNS)
      .gte("started_at", historyCutoff)
      .order("created_at", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(150),
    supabase.rpc("qeo_admin_cron_snapshot"),
    supabase
      .from("kfsp_rating_sync_runs")
      .select("id, as_of_date, status, published_row_count, staged_row_count, error_code, error_message, started_at, completed_at")
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("kfsp_ttai_sync_runs")
      .select("id, status, latest_rating_date, candidate_count, processed_count, failed_count, error_message, started_at, completed_at")
      .order("started_at", { ascending: false })
      .limit(5),
    supabase
      .from("stock_orderbook_snapshots")
      .select("session_date, updated_at")
      .order("session_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(100),
    supabase
      .from("ai_council_llm_debates")
      .select("as_of_date, ticker, call_audit, input_tokens, output_tokens, total_tokens, cached_input_tokens, reasoning_tokens, estimated_cost_usd")
      .order("as_of_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(30),
  ])

  if (runsResult.status === "fulfilled" && runsResult.value.data) {
    rawEvidence.systemJobRuns = runsResult.value.data as SystemJobRunRow[]
  }
  if (cronResult.status === "fulfilled" && Array.isArray(cronResult.value.data)) {
    rawEvidence.cronSnapshots = cronResult.value.data as CronSnapshotRow[]
    rawEvidence.schedulerReconciliation = reconcileSupabaseSchedulers({ availability: "available", rows: rawEvidence.cronSnapshots })
  } else {
    rawEvidence.schedulerReconciliation = reconcileSupabaseSchedulers({ availability: "unavailable", reason: cronResult.status === "fulfilled" ? "invalid_response" : "rpc_error" })
  }
  if (ratingResult.status === "fulfilled" && Array.isArray(ratingResult.value.data)) {
    rawEvidence.kfspRatingRuns = ratingResult.value.data as KfspRatingRunEvidence[]
  }
  if (ttaiResult.status === "fulfilled" && Array.isArray(ttaiResult.value.data)) {
    rawEvidence.kfspTtaiRuns = ttaiResult.value.data as KfspTtaiRunEvidence[]
  }
  if (orderbookResult.status === "fulfilled" && Array.isArray(orderbookResult.value.data) && orderbookResult.value.data.length > 0) {
    const rows = orderbookResult.value.data
    const latestDate = rows[0]?.session_date ? String(rows[0].session_date) : null
    const dateRows = rows.filter((r) => String(r.session_date) === latestDate)
    const latestUpdated = rows.map((r) => r.updated_at).filter(Boolean).sort().reverse()[0] ?? null
    rawEvidence.orderbookStats = {
      latestSessionDate: latestDate,
      totalSnapshots: dateRows.length,
      latestUpdatedAt: latestUpdated ? String(latestUpdated) : null,
    }
  }
  if (aiUsageResult.status === "fulfilled" && Array.isArray(aiUsageResult.value.data)) {
    rawEvidence.aiCouncilLlmDebates = aiUsageResult.value.data as AiCouncilLlmUsageRow[]
  }

  return buildAdminJobViews(EFFECTIVE_ADMIN_JOB_CATALOG, rawEvidence)
}

export async function loadAdminJobHistory(jobKey?: string, limit = 50): Promise<SystemJobRunRow[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  const maxLimit = Math.min(200, Math.max(1, limit))
  const historyCutoff = getJobHistoryCutoff()

  try {
    let query = supabase
      .from("system_job_runs")
      .select(SYSTEM_JOB_RUN_COLUMNS)
      .gte("started_at", historyCutoff)
      .order("created_at", { ascending: false })
      .order("started_at", { ascending: false })
      .limit(maxLimit)

    if (jobKey) {
      query = query.eq("job_key", jobKey)
    }

    const { data, error } = await query
    if (!error && data && data.length > 0) {
      return (data as SystemJobRunRow[]).map((r) => ({
        ...r,
        summary: sanitizeAdminValue(r.summary) as Record<string, unknown> | null,
      }))
    }

    if (jobKey === "kfsp.rating_daily") {
      const { data: ratingData } = await supabase
        .from("kfsp_rating_sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(maxLimit)

      if (ratingData && ratingData.length > 0) {
        return (ratingData as KfspRatingRunEvidence[]).map((r) => ({
          id: r.id,
          job_key: "kfsp.rating_daily",
          trigger: "cron",
          status: r.status === "completed" ? "succeeded" : r.status,
          started_at: r.started_at,
          finished_at: r.completed_at,
          duration_ms: r.completed_at ? Math.max(0, new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) : null,
          summary: {
            as_of_date: r.as_of_date,
            published_rows: r.published_row_count,
            staged_rows: r.staged_row_count,
          },
          error_code: r.error_code,
          error_message: r.error_message,
        }))
      }
    }

    if (jobKey === "kfsp.ttai_history") {
      const { data: ttaiData } = await supabase
        .from("kfsp_ttai_sync_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(maxLimit)

      if (ttaiData && ttaiData.length > 0) {
        return (ttaiData as KfspTtaiRunEvidence[]).map((r) => ({
          id: r.id,
          job_key: "kfsp.ttai_history",
          trigger: "cron",
          status: (r.failed_count > 0 && r.processed_count === 0) || r.status === "failed"
            ? "failed"
            : r.status === "completed" && r.failed_count > 0
              ? "skipped"
              : r.status === "completed"
                ? "succeeded"
                : r.status,
          started_at: r.started_at,
          finished_at: r.completed_at,
          duration_ms: r.completed_at ? Math.max(0, new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) : null,
          summary: {
            candidate_count: r.candidate_count,
            processed_count: r.processed_count,
            failed_count: r.failed_count,
            latest_rating_date: r.latest_rating_date,
          },
          error_code: r.failed_count > 0 ? "TTAI_SYNC_HTTP_207" : null,
          error_message: r.error_message,
        }))
      }
    }

    return []
  } catch {
    return []
  }
}
