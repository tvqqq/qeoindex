import { loadAdminJobsSnapshot } from "../../../../modules/admin/job-health.ts"
import { healthStateFromOperationalCounts, unknownProvider, type ProviderSnapshot } from "../health.ts"

export interface JobsHealthData {
  counts: {
    total: number
    healthy: number
    degraded: number
    failing: number
    stale: number
    inProgress: number
    unknown: number
  }
  eod: {
    status: string
    healthReason: string | null
    lastRunId: string | null
    lastStartedAt: string | null
    lastFinishedAt: string | null
    lastDurationMs: number | null
    lastErrorCode: string | null
    lastErrorMessage: string | null
    aiUsage: unknown
  } | null
}

export async function loadJobsSnapshot(): Promise<ProviderSnapshot<JobsHealthData>> {
  const observedAt = new Date().toISOString()

  try {
    const snapshot = await loadAdminJobsSnapshot()
    const eod = snapshot.jobs.find((job) => job.key === "qeoindex.eod_pipeline") ?? null
    const status = healthStateFromOperationalCounts(snapshot.counts)
    const eodIsFailing = eod?.status === "failing"

    const message = eodIsFailing && eod?.lastErrorMessage
      ? `EOD: ${eod.lastErrorMessage}`
      : status === "healthy"
        ? null
        : `Operational jobs are ${status}`

    return {
      source: "jobs",
      status,
      observedAt,
      stale: snapshot.counts.stale > 0,
      message,
      data: {
        counts: {
          total: snapshot.counts.total,
          healthy: snapshot.counts.healthy,
          degraded: snapshot.counts.degraded,
          failing: snapshot.counts.failing,
          stale: snapshot.counts.stale,
          inProgress: snapshot.counts.in_progress,
          unknown: snapshot.counts.unknown,
        },
        eod: eod ? {
          status: eod.status,
          healthReason: eod.healthReason ?? null,
          lastRunId: eod.lastRunId ?? null,
          lastStartedAt: eod.lastStartedAt ?? null,
          lastFinishedAt: eod.lastFinishedAt ?? null,
          lastDurationMs: eod.lastDurationMs ?? null,
          lastErrorCode: eod.lastErrorCode ?? null,
          lastErrorMessage: eod.lastErrorMessage ?? null,
          aiUsage: eod.aiUsage ?? null,
        } : null,
      },
    }
  } catch {
    return unknownProvider<JobsHealthData>("jobs", "QeoIndex job health unavailable", observedAt)
  }
}
