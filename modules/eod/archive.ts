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
type DailyHistoryRetentionResult = {
  status?: string
  table?: string
  cutoff?: string
  deletedRows?: number
  oldestRetainedAt?: string | null
  policy?: string
  detail?: string
}
type SafeRetentionCleanupResult = RetentionCleanupResult & {
  monitoring?: Record<string, unknown>
  rawHistoryRetention?: DailyHistoryRetentionResult
}
export type EodRetentionCleanupCheckpoint = EodArchiveCheckpoint & {
  safeCleanup?: SafeRetentionCleanupResult
  jobTelemetryCleanup?: RetentionCleanupResult
  buildArtifactCleanup?: RetentionCleanupResult
  chartIntradayArchive?: ChartIntradayArchiveMetrics
  chartIntradayArchiveError?: string
  rawHistoryRetention?: DailyHistoryRetentionResult
}

/**
 * Safe telemetry/staging retention is operational and Supabase-only.
 * Canonical Daily OHLCV is permanently bounded to rolling 5 calendar years.
 * QEO-57 removes Drive; QEO-62 removes Notion from this dependency boundary.
 * QEO-103 separately archives only chart raw 1m history after immutable object
 * checksum/readback verification.
 */
export async function runEodRetentionCleanup(
  supabase: SupabaseClient,
  input: { tradingDate: string },
): Promise<EodRetentionCleanupCheckpoint> {
  const referenceAt = new Date(`${input.tradingDate}T23:59:59.999+07:00`).toISOString()

  const cleanup = await supabase.rpc("qeo_run_safe_retention_cleanup", { p_reference_at: referenceAt })
  if (cleanup.error) return {
    status: "error",
    detail: `Safe telemetry/staging + Daily OHLCV retention failed: ${cleanup.error.message}`,
  }

  const safeCleanup = cleanup.data as SafeRetentionCleanupResult | null
  if (!safeCleanup || safeCleanup.status !== "succeeded") return {
    status: "error",
    detail: `Safe telemetry/staging + Daily OHLCV retention returned invalid status=${safeCleanup?.status || "missing"}.`,
    safeCleanup: safeCleanup || undefined,
  }

  const rawHistoryRetention = safeCleanup.rawHistoryRetention
  if (!rawHistoryRetention || rawHistoryRetention.status !== "succeeded") return {
    status: "error",
    detail: `Daily OHLCV rolling 5 calendar years retention returned invalid status=${rawHistoryRetention?.status || "missing"}.`,
    safeCleanup,
    rawHistoryRetention,
  }
  const rawHistoryDetail = `Canonical Daily OHLCV is retained for rolling 5 calendar years; cutoff=${rawHistoryRetention.cutoff || "unknown"}, deleted=${rawHistoryRetention.deletedRows ?? 0}.`

  const jobTelemetry = await supabase.rpc("qeo_run_job_telemetry_cleanup", { p_reference_at: referenceAt })
  if (jobTelemetry.error) return { status: "error", detail: `Job telemetry retention failed: ${jobTelemetry.error.message}. ${rawHistoryDetail}`, safeCleanup, rawHistoryRetention }
  const jobTelemetryCleanup = jobTelemetry.data as RetentionCleanupResult | null
  if (!jobTelemetryCleanup || jobTelemetryCleanup.status !== "succeeded") return {
    status: "error", detail: `Job telemetry retention returned invalid status=${jobTelemetryCleanup?.status || "missing"}. ${rawHistoryDetail}`,
    safeCleanup, jobTelemetryCleanup: jobTelemetryCleanup || undefined, rawHistoryRetention,
  }

  const artifactCleanup = await supabase.rpc("qeo_run_wyckoff_build_artifact_cleanup", { p_reference_at: referenceAt })
  if (artifactCleanup.error) return { status: "error", detail: `Wyckoff build-artifact retention failed: ${artifactCleanup.error.message}. ${rawHistoryDetail}`, safeCleanup, jobTelemetryCleanup, rawHistoryRetention }
  const buildArtifactCleanup = artifactCleanup.data as RetentionCleanupResult | null
  if (!buildArtifactCleanup || buildArtifactCleanup.status !== "succeeded") return {
    status: "error", detail: `Wyckoff build-artifact retention returned invalid status=${buildArtifactCleanup?.status || "missing"}. ${rawHistoryDetail}`,
    safeCleanup, jobTelemetryCleanup, buildArtifactCleanup: buildArtifactCleanup || undefined, rawHistoryRetention,
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
      rawHistoryRetention,
    }
  }

  const chartDetail = chartIntradayArchive.status === "partial"
    ? `Chart intraday archive partially completed with ${chartIntradayArchive.failures.length} isolated partition failure(s) and ${chartIntradayArchive.partitionsDeferred} fail-closed deferral(s); failed or deferred partitions remained hot.`
    : chartIntradayArchive.status === "skipped"
      ? "Chart intraday archive found no hot 1m partitions older than the five-trading-session retention cutoff."
      : `Chart intraday archive verified ${chartIntradayArchive.partitionsArchived} partition(s), archived ${chartIntradayArchive.rowsArchived} row(s), and pruned ${chartIntradayArchive.rowsPruned} verified hot row(s); ${chartIntradayArchive.partitionsDeferred} fail-closed deferral(s) remained hot.`

  return {
    status: chartIntradayArchive.status === "partial" ? "partial" : "archived",
    detail: `Daily OHLCV rolling 5 calendar years retention, safe telemetry/staging retention, bounded job telemetry retention, and terminal Wyckoff build-artifact retention completed. ${chartDetail} ${rawHistoryDetail}`,
    safeCleanup,
    jobTelemetryCleanup,
    buildArtifactCleanup,
    chartIntradayArchive,
    rawHistoryRetention,
  }
}
