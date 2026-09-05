import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"
import {
  listVerifiedColdManifests,
  readVerifiedColdManifest,
  type VerifiedColdManifest,
} from "./cold-store"
import {
  readDerivedHourlyByManifest,
  upsertDerivedHourlyBars,
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

function sameBars(left: CanonicalOhlcvBar[], right: CanonicalOhlcvBar[]) {
  if (left.length !== right.length) return false
  const leftByTime = new Map(left.map((bar) => [bar.time, bar]))
  if (leftByTime.size !== left.length) return false
  const rightTimes = new Set<number>()
  for (const b of right) {
    if (rightTimes.has(b.time)) return false
    rightTimes.add(b.time)
    const a = leftByTime.get(b.time)
    if (!a || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || a.volume !== b.volume) return false
  }
  return true
}

async function derivedManifestIds(supabase: SupabaseClient, manifestIds: string[]) {
  if (!manifestIds.length) return new Set<string>()
  const { data, error } = await supabase
    .from("chart_ohlcv_derived_hourly")
    .select("source_manifest_id")
    .in("source_manifest_id", manifestIds)
  if (error) throw new Error(`Chart derived recovery coverage read failed: ${error.message}`)
  return new Set((data || []).map((row) => String(row.source_manifest_id || "")).filter(Boolean))
}

async function listRecoveryCandidates(supabase: SupabaseClient, limit: number): Promise<VerifiedColdManifest[]> {
  const candidates: VerifiedColdManifest[] = []
  for (let offset = 0; offset < MAX_MANIFEST_SCAN_ROWS && candidates.length < limit; offset += MANIFEST_SCAN_PAGE_SIZE) {
    const page = await listVerifiedColdManifests(supabase, {
      limit: MANIFEST_SCAN_PAGE_SIZE,
      offset,
    })
    if (!page.length) break
    const covered = await derivedManifestIds(supabase, page.map((manifest) => manifest.id))
    for (const manifest of page) {
      if (!covered.has(manifest.id)) candidates.push(manifest)
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

      const cached = await upsertDerivedHourlyBars(supabase, {
        ticker: manifest.ticker,
        bars: hourlyBars,
        sourceManifestId: manifest.id,
        sourceSha256: manifest.sha256,
        sourceRangeStart: manifest.rangeStart,
        sourceRangeEnd: manifest.rangeEnd,
        sourceRawRowCount: manifest.rowCount,
        generatedAt: referenceAt.toISOString(),
      })
      const persisted = await readDerivedHourlyByManifest(supabase, manifest.id)
      if (!sameBars(hourlyBars, persisted)) {
        throw new Error(`Chart derived recovery verification mismatch: ${manifest.id}`)
      }

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
