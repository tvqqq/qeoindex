import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"
import {
  deleteHotIntradayPartition,
  listExpiredHotPartitions,
  readHotIntradayRange,
  readOldestHotIntradayTime,
  upsertHotIntradayBars,
  type HotArchivePartition,
} from "./hot-store"

const DAY_SECONDS = 86400
export const CHART_HOT_RETENTION_DAYS = 31
export const DEFAULT_ARCHIVE_PARTITIONS_PER_RUN = 12

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
  rowsPruned: number
  failures: ChartArchiveFailure[]
  oldestHotBar: string | null
}

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000))
}

/**
 * Keep 31 complete Vietnam calendar dates in hot storage. The rolling instant
 * lands inside the oldest date, so pruning begins at the following local
 * midnight instead of splitting a completed trading session in half.
 */
export function chartHotRetentionCutoff(referenceAt: Date) {
  const rollingEpoch = Math.floor(referenceAt.getTime() / 1000) - CHART_HOT_RETENTION_DAYS * DAY_SECONDS
  const rollingDate = vietnamDateKey(rollingEpoch)
  return Math.floor(new Date(`${rollingDate}T00:00:00+07:00`).getTime() / 1000) + DAY_SECONDS
}

function sameBars(left: CanonicalOhlcvBar[], right: CanonicalOhlcvBar[]) {
  if (left.length !== right.length) return false
  const leftByTime = new Map(left.map((bar) => [bar.time, bar]))
  if (leftByTime.size !== left.length) return false
  for (const b of right) {
    const a = leftByTime.get(b.time)
    if (!a || a.open !== b.open || a.high !== b.high || a.low !== b.low || a.close !== b.close || a.volume !== b.volume) {
      return false
    }
  }
  return true
}

async function readPartition(
  supabase: SupabaseClient,
  partition: HotArchivePartition,
  cutoff: number,
) {
  const bars = await readHotIntradayRange(supabase, partition.ticker, partition.from, partition.toExclusive - 1)
  return bars.filter((bar) => bar.time < cutoff)
}

function failure(partition: HotArchivePartition, cause: unknown): ChartArchiveFailure {
  return {
    ticker: partition.ticker,
    tradingDate: partition.tradingDate,
    error: cause instanceof Error ? cause.message : String(cause),
  }
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
  let rowsPruned = 0
  const failures: ChartArchiveFailure[] = []

  for (const partition of partitions) {
    try {
      const beforeArchive = await readPartition(supabase, partition, cutoff)
      if (!beforeArchive.length) continue

      const archived = await cold.archiveVerifiedPartition({ ticker: partition.ticker, bars: beforeArchive })

      // Re-read after immutable cold verification. Old completed bars should be
      // stable; if not, fail closed and leave hot rows untouched.
      const beforePrune = await readPartition(supabase, partition, cutoff)
      if (!sameBars(beforeArchive, beforePrune)) {
        throw new Error("Chart hot partition changed during archive verification; prune aborted")
      }

      const deleted = await deleteHotIntradayPartition(supabase, { ...partition, cutoff })
      if (!sameBars(beforePrune, deleted)) {
        if (deleted.length) {
          await upsertHotIntradayBars(supabase, {
            ticker: partition.ticker,
            bars: deleted,
            provider: "ARCHIVE_PRUNE_ROLLBACK",
            detail: {
              reason: "deleted snapshot did not match verified archive",
              tradingDate: partition.tradingDate,
              archivedObjectPath: archived.objectPath,
            },
          })
        }
        throw new Error(`Chart archive prune mismatch: verified=${beforePrune.length} deleted=${deleted.length}; deleted rows restored`)
      }

      partitionsArchived += 1
      if (archived.reused) reusedArchives += 1
      rowsArchived += archived.rowCount
      bytesWritten += archived.byteCount
      rowsPruned += deleted.length
    } catch (cause) {
      failures.push(failure(partition, cause))
    }
  }

  const oldestHotEpoch = await readOldestHotIntradayTime(supabase)
  const status = partitions.length === 0
    ? "skipped"
    : failures.length > 0
      ? "partial"
      : "succeeded"

  return {
    status,
    referenceAt: referenceAt.toISOString(),
    cutoff: new Date(cutoff * 1000).toISOString(),
    partitionsConsidered: partitions.length,
    partitionsArchived,
    reusedArchives,
    rowsArchived,
    bytesWritten,
    rowsPruned,
    failures,
    oldestHotBar: oldestHotEpoch == null ? null : new Date(oldestHotEpoch * 1000).toISOString(),
  }
}
