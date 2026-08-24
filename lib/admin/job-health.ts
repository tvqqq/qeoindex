import { ADMIN_JOB_CATALOG } from "./catalog.ts"
import { sanitizeAdminValue } from "./redact.ts"
import type { AdminJobDefinition, AdminJobStatus, AdminJobView, AdminSystemOverview } from "./types.ts"

export interface LatestRunSnapshot {
  status: string
  startedAt?: string | null
  finishedAt?: string | null
}

export interface SystemJobRunRow {
  id: string
  job_key: string
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

async function getSupabase() {
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  return getSupabaseServerClient()
}

export function deriveAdminJobStatus(
  definition: AdminJobDefinition,
  latestRun: LatestRunSnapshot | null,
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

export function buildAdminJobViews(
  catalog: AdminJobDefinition[],
  runs: SystemJobRunRow[],
  cronSnapshots: CronSnapshotRow[] = [],
  now: Date = new Date(),
): { jobs: AdminJobView[]; counts: AdminSystemOverview["jobCounts"] } {
  const latestRunByJob = new Map<string, SystemJobRunRow>()
  for (const run of runs) {
    if (!latestRunByJob.has(run.job_key)) {
      latestRunByJob.set(run.job_key, run)
    }
  }

  const cronByName = new Map<string, CronSnapshotRow>()
  for (const cron of cronSnapshots) {
    if (cron.jobName) {
      cronByName.set(cron.jobName, cron)
    }
  }

  const counts = {
    total: catalog.length,
    healthy: 0,
    degraded: 0,
    failing: 0,
    stale: 0,
    unknown: 0,
  }

  const jobs: AdminJobView[] = catalog.map((def) => {
    const latestRun = latestRunByJob.get(def.key)
    const cron = cronByName.get(def.key)

    let effectiveStatus: AdminJobStatus = "unknown"
    let lastRunId: string | null = null
    let lastTrigger: string | null = null
    let lastStartedAt: string | null = null
    let lastFinishedAt: string | null = null
    let lastDurationMs: number | null = null
    let lastSummary: Record<string, unknown> | null = null
    let lastErrorCode: string | null = null
    let lastErrorMessage: string | null = null

    if (latestRun) {
      effectiveStatus = deriveAdminJobStatus(
        def,
        {
          status: latestRun.status,
          startedAt: latestRun.started_at,
          finishedAt: latestRun.finished_at,
        },
        now,
      )
      lastRunId = latestRun.id
      lastTrigger = latestRun.trigger
      lastStartedAt = latestRun.started_at
      lastFinishedAt = latestRun.finished_at ?? null
      lastDurationMs = latestRun.duration_ms ?? null
      lastSummary = sanitizeAdminValue(latestRun.summary) as Record<string, unknown> | null
      lastErrorCode = latestRun.error_code ?? null
      lastErrorMessage = latestRun.error_message ?? null
    } else if (cron) {
      effectiveStatus = deriveAdminJobStatus(
        def,
        {
          status: cron.lastStatus || (cron.active ? "succeeded" : "unknown"),
          startedAt: cron.lastStartedAt,
          finishedAt: cron.lastFinishedAt,
        },
        now,
      )
      lastTrigger = "cron"
      lastStartedAt = cron.lastStartedAt
      lastFinishedAt = cron.lastFinishedAt
    }

    counts[effectiveStatus] += 1

    return {
      key: def.key,
      provider: def.provider,
      label: def.label,
      description: def.description,
      group: def.group,
      scheduleUtc: def.scheduleUtc,
      scheduleIct: def.scheduleIct,
      manualPolicy: def.manualPolicy,
      status: effectiveStatus,
      lastRunId,
      lastTrigger,
      lastStartedAt,
      lastFinishedAt,
      lastDurationMs,
      lastSummary,
      lastErrorCode,
      lastErrorMessage,
    }
  })

  return { jobs, counts }
}

export async function loadAdminJobsSnapshot(): Promise<{ jobs: AdminJobView[]; counts: AdminSystemOverview["jobCounts"] }> {
  const supabase = await getSupabase()
  if (!supabase) {
    return buildAdminJobViews(ADMIN_JOB_CATALOG, [])
  }

  let runs: SystemJobRunRow[] = []
  let cronSnapshots: CronSnapshotRow[] = []

  try {
    const { data: runData } = await supabase
      .from("system_job_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(150)

    if (runData) {
      runs = runData as SystemJobRunRow[]
    }
  } catch (err: unknown) {
    console.warn("Failed to load system job runs:", err)
  }

  try {
    const { data: cronData } = await supabase.rpc("qeo_admin_cron_snapshot")
    if (cronData && Array.isArray(cronData)) {
      cronSnapshots = cronData as CronSnapshotRow[]
    }
  } catch {
    // pg_cron snapshot RPC may be unavailable or empty, degrade gracefully
  }

  return buildAdminJobViews(ADMIN_JOB_CATALOG, runs, cronSnapshots)
}

export async function loadAdminJobHistory(jobKey?: string, limit = 50): Promise<SystemJobRunRow[]> {
  const supabase = await getSupabase()
  if (!supabase) return []

  try {
    let query = supabase
      .from("system_job_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(Math.min(200, Math.max(1, limit)))

    if (jobKey) {
      query = query.eq("job_key", jobKey)
    }

    const { data, error } = await query
    if (error || !data) return []

    return (data as SystemJobRunRow[]).map((r) => ({
      ...r,
      summary: sanitizeAdminValue(r.summary) as Record<string, unknown> | null,
    }))
  } catch {
    return []
  }
}
