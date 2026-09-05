import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"
import { upsertDerivedHourlyBars } from "./derived-hourly-store"
import { CHART_HOT_RETENTION_DAYS, chartHotRetentionCutoff } from "./history-policy"
import {
  listExpiredHotPartitions,
  pruneVerifiedHotIntradayPartition,
  readHotIntradayRange,
  readOldestHotIntradayTime,
  type HotArchivePartition,
} from "./hot-store"
import { aggregateChartTimeframe } from "./timeframes"

export { CHART_HOT_RETENTION_DAYS, chartHotRetentionCutoff }
export const DEFAULT_ARCHIVE_PARTITIONS_PER_RUN = 48

export interface ChartArchiveFailure {
  ticker: string
  tradingDate: string
  error: string
}

export interface ChartIntradayArchiveMetrics {
  status: "succeeded" | "partial" | "skipped"
  referenceAt: string
  cutoff: string
  partitionsConsidered: number
  partitionsArchived: number
  reusedArchives: number
  rowsArchived: number
  bytesWritten: number
  hourlyRowsCached: number
  rowsPruned: number
  failures: ChartArchiveFailure[]
  oldestHotBar: string | null
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

async function readPartition(supabase: SupabaseClient, partition: HotArchivePartition, cutoff: number) {
  const bars = await readHotIntradayRange(supabase, partition.ticker, partition.from, partition.toExclusive - 1)
  return bars.filter((bar) => bar.time < cutoff)
}

function failure(partition: HotArchivePartition, cause: unknown): ChartArchiveFailure {
  return { ticker: partition.ticker, tradingDate: partition.tradingDate, error: cause instanceof Error ? cause.message : String(cause) }
}

export async function runChartIntradayArchiveLifecycle(
  supabase: SupabaseClient,
  input: { referenceAt?: Date; maxPartitions?: number } = {},
): Promise<ChartIntradayArchiveMetrics> {
  const referenceAt = input.referenceAt ?? new Date()
  const cutoff = chartHotRetentionCutoff(referenceAt)
  const maxPartitions = Math.max(1, Math.min(48, Math.floor(input.maxPartitions ?? DEFAULT_ARCHIVE_PARTITIONS_PER_RUN)))
  const partitions = await listExpiredHotPartitions(supabase, { cutoff, maxPartitions })
  const cold = createSupabaseColdOhlcvStorage(supabase)

  let partitionsArchived = 0
  let reusedArchives = 0
  let rowsArchived = 0
  let bytesWritten = 0
  let hourlyRowsCached = 0
  let rowsPruned = 0
  const failures: ChartArchiveFailure[] = []

  for (const partition of partitions) {
    try {
      const beforeArchive = await readPartition(supabase, partition, cutoff)
      if (!beforeArchive.length) continue
      const archived = await cold.archiveVerifiedPartition({ ticker: partition.ticker, bars: beforeArchive })
      const hourlyBars = aggregateChartTimeframe(beforeArchive, "1h")
      if (!hourlyBars.length) throw new Error("Verified raw archive produced no deterministic 1h cache bars")
      const cached = await upsertDerivedHourlyBars(supabase, {
        ticker: partition.ticker,
        bars: hourlyBars,
        sourceManifestId: archived.manifestId,
        sourceSha256: archived.sha256,
        sourceRangeStart: beforeArchive[0].time,
        sourceRangeEnd: beforeArchive.at(-1)!.time,
        sourceRawRowCount: archived.rowCount,
        generatedAt: referenceAt.toISOString(),
      })
      const beforePrune = await readPartition(supabase, partition, cutoff)
      if (!sameBars(beforeArchive, beforePrune)) throw new Error("Chart hot partition changed during archive/cache verification; prune aborted")
      const deletedRows = await pruneVerifiedHotIntradayPartition(supabase, {
        manifestId: archived.manifestId,
        sha256: archived.sha256,
        rowCount: archived.rowCount,
      })
      partitionsArchived += 1
      if (archived.reused) reusedArchives += 1
      rowsArchived += archived.rowCount
      bytesWritten += archived.byteCount
      hourlyRowsCached += cached.rowCount
      rowsPruned += deletedRows
    } catch (cause) {
      failures.push(failure(partition, cause))
    }
  }

  const oldestHotEpoch = await readOldestHotIntradayTime(supabase)
  const status = partitions.length === 0 ? "skipped" : failures.length > 0 ? "partial" : "succeeded"
  return {
    status,
    referenceAt: referenceAt.toISOString(),
    cutoff: new Date(cutoff * 1000).toISOString(),
    partitionsConsidered: partitions.length,
    partitionsArchived,
    reusedArchives,
    rowsArchived,
    bytesWritten,
    hourlyRowsCached,
    rowsPruned,
    failures,
    oldestHotBar: oldestHotEpoch == null ? null : new Date(oldestHotEpoch * 1000).toISOString(),
  }
}
