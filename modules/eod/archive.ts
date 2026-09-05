import type { SupabaseClient } from "@supabase/supabase-js"
import { runChartIntradayArchiveLifecycle, type ChartIntradayArchiveMetrics } from "@/modules/market/chart-data/archive-lifecycle"

export interface EodArchiveCheckpoint {
  status: "archived" | "partial" | "blocked" | "skipped" | "error"
  archived?: number
  requested?: number
  rowCount?: number
  detail?: string
  manifestUrl?: string | null
  manifestSha256?: string | null
}

type RetentionCleanupResult = {
  status?: string
  referenceAt?: string
  durationMs?: number
  tables?: Array<{ table?: string; cutoff?: string; deletedRows?: number; oldestRetainedAt?: string | null; policy?: string }>
}
type SafeRetentionCleanupResult = RetentionCleanupResult & {
  monitoring?: Record<string, unknown>
  rawHistoryRetention?: { status?: string; table?: string; detail?: string }
}
export type EodRetentionCleanupCheckpoint = EodArchiveCheckpoint & {
  safeCleanup?: SafeRetentionCleanupResult
  jobTelemetryCleanup?: RetentionCleanupResult
  buildArtifactCleanup?: RetentionCleanupResult
  chartIntradayArchive?: ChartIntradayArchiveMetrics
  chartIntradayArchiveError?: string
  rawHistoryRetention?: { status: "blocked"; detail: string }
}

/**
 * Safe telemetry/staging retention is operational and Supabase-only.
 * QEO-57 removes Drive; QEO-62 removes Notion from this dependency boundary.
 * Raw Daily history remains retained. QEO-103 separately archives only chart
 * raw 1m history after immutable object checksum/readback verification.
 */
export async function runEodRetentionCleanup(
  supabase: SupabaseClient,
  input: { tradingDate: string },
): Promise<EodRetentionCleanupCheckpoint> {
  const rawHistoryDetail = "Raw Daily OHLCV retention is intentionally disabled until an independently verified cold-backup hydration/restore design exists; no operational Daily bars were deleted."
  const referenceAt = new Date(`${input.tradingDate}T23:59:59.999+07:00`).toISOString()
  const cleanup = await supabase.rpc("qeo_run_safe_retention_cleanup", { p_reference_at: referenceAt })
  if (cleanup.error) return { status: "error", detail: `Safe telemetry/staging retention failed: ${cleanup.error.message}. ${rawHistoryDetail}`, rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail } }

  const safeCleanup = cleanup.data as SafeRetentionCleanupResult | null
  if (!safeCleanup || safeCleanup.status !== "succeeded") return {
    status: "error", detail: `Safe telemetry/staging retention returned invalid status=${safeCleanup?.status || "missing"}. ${rawHistoryDetail}`,
    safeCleanup: safeCleanup || undefined, rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
  }

  const jobTelemetry = await supabase.rpc("qeo_run_job_telemetry_cleanup", { p_reference_at: referenceAt })
  if (jobTelemetry.error) return { status: "error", detail: `Job telemetry retention failed: ${jobTelemetry.error.message}. ${rawHistoryDetail}`, safeCleanup, rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail } }
  const jobTelemetryCleanup = jobTelemetry.data as RetentionCleanupResult | null
  if (!jobTelemetryCleanup || jobTelemetryCleanup.status !== "succeeded") return {
    status: "error", detail: `Job telemetry retention returned invalid status=${jobTelemetryCleanup?.status || "missing"}. ${rawHistoryDetail}`,
    safeCleanup, jobTelemetryCleanup: jobTelemetryCleanup || undefined, rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
  }

  const artifactCleanup = await supabase.rpc("qeo_run_wyckoff_build_artifact_cleanup", { p_reference_at: referenceAt })
  if (artifactCleanup.error) return { status: "error", detail: `Wyckoff build-artifact retention failed: ${artifactCleanup.error.message}. ${rawHistoryDetail}`, safeCleanup, jobTelemetryCleanup, rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail } }
  const buildArtifactCleanup = artifactCleanup.data as RetentionCleanupResult | null
  if (!buildArtifactCleanup || buildArtifactCleanup.status !== "succeeded") return {
    status: "error", detail: `Wyckoff build-artifact retention returned invalid status=${buildArtifactCleanup?.status || "missing"}. ${rawHistoryDetail}`,
    safeCleanup, jobTelemetryCleanup, buildArtifactCleanup: buildArtifactCleanup || undefined, rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
  }

  let chartIntradayArchive: ChartIntradayArchiveMetrics
  try {
    chartIntradayArchive = await runChartIntradayArchiveLifecycle(supabase, { referenceAt: new Date(referenceAt) })
  } catch (cause) {
    const chartIntradayArchiveError = cause instanceof Error ? cause.message : String(cause)
    return {
      status: "partial",
      detail: `Core safe retention completed, but chart intraday archive discovery/lifecycle failed before a safe prune could complete: ${chartIntradayArchiveError}. ${rawHistoryDetail}`,
      safeCleanup,
      jobTelemetryCleanup,
      buildArtifactCleanup,
      chartIntradayArchiveError,
      rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
    }
  }

  const chartDetail = chartIntradayArchive.status === "partial"
    ? `Chart intraday archive partially completed with ${chartIntradayArchive.failures.length} isolated partition failure(s); failed partitions remained/reverted hot.`
    : chartIntradayArchive.status === "skipped"
      ? "Chart intraday archive found no hot 1m partitions older than the 31-day retention cutoff."
      : `Chart intraday archive verified ${chartIntradayArchive.partitionsArchived} partition(s), archived ${chartIntradayArchive.rowsArchived} row(s), and pruned ${chartIntradayArchive.rowsPruned} verified hot row(s).`

  return {
    status: chartIntradayArchive.status === "partial" ? "partial" : "archived",
    detail: `Safe telemetry/staging retention, bounded job telemetry retention, and terminal Wyckoff build-artifact retention completed. ${chartDetail} ${rawHistoryDetail}`,
    safeCleanup,
    jobTelemetryCleanup,
    buildArtifactCleanup,
    chartIntradayArchive,
    rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
  }
}
