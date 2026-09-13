import { loadAdminJobsSnapshot } from "../../../../modules/admin/job-health.ts"
import type { AdminJobStatus } from "../../../../modules/admin/types.ts"
import { unknownProvider, type HealthState, type ProviderSnapshot } from "../health.ts"

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

function mapAdminStatus(status: AdminJobStatus): HealthState {
  switch (status) {
    case "failing":
      return "critical"
    case "degraded":
    case "stale":
      return "degraded"
    case "unknown":
      return "unknown"
    case "healthy":
    case "in_progress":
      return "healthy"
  }
}

export async function loadJobsSnapshot(): Promise<ProviderSnapshot<JobsHealthData>> {
  const observedAt = new Date().toISOString()

  try {
    const snapshot = await loadAdminJobsSnapshot()
    const eod = snapshot.jobs.find((job) => job.key === "qeoindex.eod_pipeline") ?? null
    const status = mapAdminStatus(eod?.status ?? (snapshot.counts.failing > 0
      ? "failing"
      : snapshot.counts.degraded > 0 || snapshot.counts.stale > 0
        ? "degraded"
        : snapshot.counts.unknown > 0
          ? "unknown"
          : "healthy"))

    const message = eod?.lastErrorMessage
      ? `EOD: ${eod.lastErrorMessage}`
      : status === "healthy"
        ? null
        : eod?.healthReason || `Operational jobs are ${status}`

    return {
      source: "jobs",
      status,
      observedAt,
      stale: eod?.status === "stale",
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
