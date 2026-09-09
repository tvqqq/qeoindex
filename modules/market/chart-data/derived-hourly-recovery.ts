import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  listVerifiedColdManifests,
  readVerifiedColdManifest,
  type VerifiedColdManifest,
} from "./cold-store"
import {
  derivedHourlySourceProof,
  persistVerifiedDerivedHourlyGeneration,
  validateDerivedHourlyManifestReadiness,
} from "./derived-hourly-store"
import { aggregateChartTimeframe } from "./timeframes"

const MANIFEST_SCAN_PAGE_SIZE = 100
const MAX_MANIFEST_SCAN_ROWS = 5_000
export const DEFAULT_DERIVED_RECOVERY_PARTITIONS_PER_RUN = 12

export interface ChartDerivedRecoveryFailure {
  manifestId: string
  ticker: string
  error: string
}

export interface ChartDerivedHourlyRecoveryMetrics {
  status: "succeeded" | "partial" | "skipped"
  referenceAt: string
  manifestsConsidered: number
  manifestsRecovered: number
  rawRowsVerified: number
  bytesVerified: number
  hourlyRowsCached: number
  failures: ChartDerivedRecoveryFailure[]
}

async function listRecoveryCandidates(supabase: SupabaseClient, limit: number): Promise<VerifiedColdManifest[]> {
  const candidates: VerifiedColdManifest[] = []
  for (let offset = 0; offset < MAX_MANIFEST_SCAN_ROWS && candidates.length < limit; offset += MANIFEST_SCAN_PAGE_SIZE) {
    const page = await listVerifiedColdManifests(supabase, {
      limit: MANIFEST_SCAN_PAGE_SIZE,
      offset,
    })
    if (!page.length) break
    const readiness = await validateDerivedHourlyManifestReadiness(supabase, page.map((manifest) => manifest.id))
    for (const manifest of page) {
      if (readiness.get(manifest.id)?.ready !== true) candidates.push(manifest)
      if (candidates.length >= limit) break
    }
    if (page.length < MANIFEST_SCAN_PAGE_SIZE) break
  }
  return candidates
}

function recoveryFailure(manifest: VerifiedColdManifest, cause: unknown): ChartDerivedRecoveryFailure {
  return {
    manifestId: manifest.id,
    ticker: manifest.ticker,
    error: cause instanceof Error ? cause.message : String(cause),
  }
}

export async function runChartDerivedHourlyRecovery(
  supabase: SupabaseClient,
  input: { referenceAt?: Date; maxPartitions?: number } = {},
): Promise<ChartDerivedHourlyRecoveryMetrics> {
  const referenceAt = input.referenceAt ?? new Date()
  const maxPartitions = Math.max(1, Math.min(48, Math.floor(input.maxPartitions ?? DEFAULT_DERIVED_RECOVERY_PARTITIONS_PER_RUN)))
  const manifests = await listRecoveryCandidates(supabase, maxPartitions)

  let manifestsRecovered = 0
  let rawRowsVerified = 0
  let bytesVerified = 0
  let hourlyRowsCached = 0
  const failures: ChartDerivedRecoveryFailure[] = []

  for (const manifest of manifests) {
    try {
      const verified = await readVerifiedColdManifest(supabase, manifest)
      const hourlyBars = aggregateChartTimeframe(verified.bars, "1h")
      if (!hourlyBars.length) throw new Error(`Verified cold manifest produced no deterministic 1h bars: ${manifest.id}`)

      const { error: manifestRefreshError } = await supabase
        .from("chart_ohlcv_cold_manifests")
        .update({
          verified_at: referenceAt.toISOString(),
          format_version: manifest.formatVersion,
          byte_count: verified.byteCount,
        })
        .eq("id", manifest.id)
      if (manifestRefreshError) throw new Error(`Chart derived recovery manifest refresh failed: ${manifestRefreshError.message}`)

      // QEO-103's former upsertDerivedHourlyBars -> readDerivedHourlyByManifest
      // sequence is now encapsulated by this QEO-147 generation publication,
      // which performs exact readback before publishing readiness.
      const cached = await persistVerifiedDerivedHourlyGeneration(supabase, {
        ticker: manifest.ticker,
        bars: hourlyBars,
        ...derivedHourlySourceProof(manifest),
        generatedAt: referenceAt.toISOString(),
      })

      manifestsRecovered += 1
      rawRowsVerified += manifest.rowCount
      bytesVerified += verified.byteCount
      hourlyRowsCached += cached.rowCount
    } catch (cause) {
      failures.push(recoveryFailure(manifest, cause))
    }
  }

  return {
    status: manifests.length === 0 ? "skipped" : failures.length ? "partial" : "succeeded",
    referenceAt: referenceAt.toISOString(),
    manifestsConsidered: manifests.length,
    manifestsRecovered,
    rawRowsVerified,
    bytesVerified,
    hourlyRowsCached,
    failures,
  }
}
