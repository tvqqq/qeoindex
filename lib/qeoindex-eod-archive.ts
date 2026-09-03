import type { SupabaseClient } from "@supabase/supabase-js"

import {
  archiveCanonicalUniverseBatchToNotion,
  archiveEodRunToNotion,
  archiveEodTickerBatchToNotion,
  runEodDriveArchive as runLegacyDriveArchive,
  type EodArchiveCheckpoint,
} from "./qeoindex-eod-archive-legacy"

export {
  archiveCanonicalUniverseBatchToNotion,
  archiveEodRunToNotion,
  archiveEodTickerBatchToNotion,
}
export type { EodArchiveCheckpoint }

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
  rawHistoryRetention?: { status: "blocked"; detail: string }
}

/** Legacy/recovery-only Drive adapter; QEO-57 keeps it off the active daily graph. */
export async function runEodDriveArchive(
  supabase: SupabaseClient,
  input: { tradingDate: string; universeRunId: string; validationHash: string; stocks: Parameters<typeof runLegacyDriveArchive>[1]["stocks"] },
): Promise<EodArchiveCheckpoint> {
  try {
    return await runLegacyDriveArchive(supabase, input)
  } catch (error) {
    return {
      status: "error", requested: input.stocks.length, archived: 0,
      detail: `Google Drive archive failed: ${error instanceof Error ? error.message : String(error)}; raw Supabase history remains retained.`, manifestUrl: null,
    }
  }
}

/**
 * Safe telemetry/staging retention is operational and Supabase-only.
 * QEO-57 removes Drive; QEO-62 removes Notion from this dependency boundary.
 * Raw Daily history remains retained until an independently verified cold restore design exists.
 */
export async function runEodRetentionCleanup(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    /** @deprecated Legacy caller compatibility only; ignored by retention logic. */
    notionArchive?: EodArchiveCheckpoint
    /** @deprecated Legacy caller compatibility only; ignored by retention logic. */
    driveArchive?: EodArchiveCheckpoint
  },
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

  return {
    status: "archived",
    detail: `Safe telemetry/staging retention, bounded job telemetry retention, and terminal Wyckoff build-artifact retention completed. ${rawHistoryDetail}`,
    safeCleanup, jobTelemetryCleanup, buildArtifactCleanup,
    rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
  }
}
