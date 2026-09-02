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
  tables?: Array<{
    table?: string
    cutoff?: string
    deletedRows?: number
    oldestRetainedAt?: string | null
    policy?: string
  }>
}

type SafeRetentionCleanupResult = RetentionCleanupResult & {
  monitoring?: Record<string, unknown>
  rawHistoryRetention?: {
    status?: string
    table?: string
    detail?: string
  }
}

export type EodRetentionCleanupCheckpoint = EodArchiveCheckpoint & {
  safeCleanup?: SafeRetentionCleanupResult
  jobTelemetryCleanup?: RetentionCleanupResult
  rawHistoryRetention?: {
    status: "blocked"
    detail: string
  }
}

/**
 * Daily/Weekly cutover: the active raw read/write contract is Daily-only and Weekly
 * is derived deterministically. Legacy 1H rows remain preserved until cold-archive
 * coverage is verified. The proven Google Drive/auth/manifest uploader is reused.
 */
export async function runEodDriveArchive(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    universeRunId: string
    validationHash: string
    stocks: Parameters<typeof runLegacyDriveArchive>[1]["stocks"]
  },
): Promise<EodArchiveCheckpoint> {
  return runLegacyDriveArchive(supabase, input)
}

/**
 * QEO-21 separates safe telemetry/staging TTL from raw market-history retention.
 * QEO-29 tightens only execution telemetry: detailed phases are kept for one day
 * and terminal run summaries for seven days. Active queued/running lifecycles are
 * preserved by the database RPC.
 *
 * Raw Daily history remains the sole active source for both 1D and derived 1W
 * Wyckoff analysis and is never age-pruned here. Plan C cold-history hydration and
 * restore proof is still required before that policy can change.
 */
export async function runEodRetentionCleanup(
  supabase: SupabaseClient,
  input: {
    tradingDate: string
    notionArchive: EodArchiveCheckpoint
    driveArchive: EodArchiveCheckpoint
  },
): Promise<EodRetentionCleanupCheckpoint> {
  const rawHistoryDetail = "Raw Daily OHLCV retention is intentionally disabled until Plan C cold-history hydration/restore is verified; no operational Daily bars were deleted."
  const referenceAt = new Date(`${input.tradingDate}T23:59:59.999+07:00`).toISOString()
  const cleanup = await supabase.rpc("qeo_run_safe_retention_cleanup", {
    p_reference_at: referenceAt,
  })

  if (cleanup.error) {
    return {
      status: "error",
      detail: `Safe telemetry/staging retention failed: ${cleanup.error.message}. ${rawHistoryDetail}`,
      rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
    }
  }

  const safeCleanup = cleanup.data as SafeRetentionCleanupResult | null
  if (!safeCleanup || safeCleanup.status !== "succeeded") {
    return {
      status: "error",
      detail: `Safe telemetry/staging retention returned invalid status=${safeCleanup?.status || "missing"}. ${rawHistoryDetail}`,
      safeCleanup: safeCleanup || undefined,
      rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
    }
  }

  const jobTelemetry = await supabase.rpc("qeo_run_job_telemetry_cleanup", {
    p_reference_at: referenceAt,
  })
  if (jobTelemetry.error) {
    return {
      status: "error",
      detail: `Job telemetry retention failed: ${jobTelemetry.error.message}. ${rawHistoryDetail}`,
      safeCleanup,
      rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
    }
  }

  const jobTelemetryCleanup = jobTelemetry.data as RetentionCleanupResult | null
  if (!jobTelemetryCleanup || jobTelemetryCleanup.status !== "succeeded") {
    return {
      status: "error",
      detail: `Job telemetry retention returned invalid status=${jobTelemetryCleanup?.status || "missing"}. ${rawHistoryDetail}`,
      safeCleanup,
      jobTelemetryCleanup: jobTelemetryCleanup || undefined,
      rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
    }
  }

  const archiveContext = [
    `Notion archive=${input.notionArchive.status}`,
    `Drive archive=${input.driveArchive.status}`,
  ].join(", ")

  return {
    status: "archived",
    detail: `Safe telemetry/staging retention and bounded job telemetry retention completed (${archiveContext}). ${rawHistoryDetail}`,
    safeCleanup,
    jobTelemetryCleanup,
    rawHistoryRetention: { status: "blocked", detail: rawHistoryDetail },
  }
}
