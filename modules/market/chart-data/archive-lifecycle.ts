import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import { upsertDerivedHourlyBars } from "./derived-hourly-store"
import {
  CHART_HOT_RETENTION_DAYS,
  CHART_HOT_RETENTION_SESSIONS,
  chartHotRetentionCutoff,
  chartHotSessionRetentionCutoff,
} from "./history-policy"
import {
  ChartHotContentIdentityUnavailableError,
  dropEmptyHotIntradaySessionPartition,
  canonicalHotContentDigest,
  canonicalHotContentVersion,
  listExpiredHotPartitions,
  pruneVerifiedHotIntradayPartition,
  proveHotArchivePartitionsEligibility,
  readHotIntradaySnapshot,
  type HotIntradaySnapshot,
  readOldestHotIntradayTime,
  type HotArchivePartition,
} from "./hot-store"
import { aggregateChartTimeframe } from "./timeframes"

export {
  CHART_HOT_RETENTION_DAYS,
  CHART_HOT_RETENTION_SESSIONS,
  chartHotRetentionCutoff,
  chartHotSessionRetentionCutoff,
}
export const DEFAULT_ARCHIVE_PARTITIONS_PER_RUN = 48

export interface ChartArchiveFailure {
  ticker: string
  tradingDate: string
  error: string
}

export interface ChartArchiveDeferredPartition {
  ticker: string
  tradingDate: string
  reason: string
  newerTradingDates: string[]
  rowsScanned: number
  pagesRead: number
  error?: string
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
  sessionPartitionsDropped: number
  failures: ChartArchiveFailure[]
  partitionsDeferred: number
  deferred: ChartArchiveDeferredPartition[]
  oldestHotBar: string | null
}

async function readPartition(supabase: SupabaseClient, partition: HotArchivePartition, cutoff: number) {
  const snapshots = await readHotIntradaySnapshot(supabase, partition.ticker, partition.from, partition.toExclusive - 1)
  return snapshots.filter((snapshot) => snapshot.bar.time < cutoff)
}

function sameSnapshots(left: HotIntradaySnapshot[], right: HotIntradaySnapshot[]) {
  if (left.length !== right.length) return false
  return left.every((snapshot, index) => {
    const other = right[index]
    return other
      && snapshot.bar.time === other.bar.time
      && snapshot.contentDigest === other.contentDigest
      && snapshot.contentVersion === other.contentVersion
  })
}

function failure(partition: HotArchivePartition, cause: unknown): ChartArchiveFailure {
  return { ticker: partition.ticker, tradingDate: partition.tradingDate, error: cause instanceof Error ? cause.message : String(cause) }
}

export async function runChartIntradayArchiveLifecycle(
  supabase: SupabaseClient,
  input: { referenceAt?: Date; maxPartitions?: number } = {},
): Promise<ChartIntradayArchiveMetrics> {
  const referenceAt = input.referenceAt ?? new Date()
  const cutoff = chartHotSessionRetentionCutoff(referenceAt)
  const maxPartitions = Math.max(1, Math.min(48, Math.floor(input.maxPartitions ?? DEFAULT_ARCHIVE_PARTITIONS_PER_RUN)))
  const partitions = await listExpiredHotPartitions(supabase, { cutoff, maxPartitions })
  const retentionProofs = await proveHotArchivePartitionsEligibility(supabase, partitions)
  const cold = createSupabaseColdOhlcvStorage(supabase)

  let partitionsArchived = 0
  let reusedArchives = 0
  let rowsArchived = 0
  let bytesWritten = 0
  let hourlyRowsCached = 0
  let rowsPruned = 0
  let sessionPartitionsDropped = 0
  const failures: ChartArchiveFailure[] = []
  const deferred: ChartArchiveDeferredPartition[] = []

  for (const partition of partitions) {
    try {
      // Discovery's global cutoff is only a bounded candidate hint. The
      // per-ticker proof is the final latest-five-session HOT guard.
      const retentionProof = retentionProofs.get(`${partition.ticker}:${partition.tradingDate}`)
      if (!retentionProof) throw new Error("Chart HOT retention proof missing for discovered partition")
      if (!retentionProof.eligible) {
        deferred.push({
          ticker: partition.ticker,
          tradingDate: partition.tradingDate,
          reason: retentionProof.reason,
          newerTradingDates: retentionProof.newerTradingDates,
          rowsScanned: retentionProof.rowsScanned,
          pagesRead: retentionProof.pagesRead,
          ...(retentionProof.error ? { error: retentionProof.error } : {}),
        })
        continue
      }

      let beforeArchive: HotIntradaySnapshot[]
      try {
        beforeArchive = await readPartition(supabase, partition, cutoff)
      } catch (cause) {
        if (cause instanceof ChartHotContentIdentityUnavailableError) {
          deferred.push({
            ticker: partition.ticker,
            tradingDate: partition.tradingDate,
            reason: "content_identity_unavailable",
            newerTradingDates: retentionProof.newerTradingDates,
            rowsScanned: retentionProof.rowsScanned,
            pagesRead: retentionProof.pagesRead,
          })
          continue
        }
        throw cause
      }
      if (!beforeArchive.length) continue
      const beforeArchiveBars = beforeArchive.map((snapshot) => snapshot.bar)
      const archived = await cold.archiveVerifiedPartition({
        ticker: partition.ticker,
        bars: beforeArchiveBars,
        canonicalContentDigest: canonicalHotContentDigest(beforeArchive),
        canonicalContentVersion: canonicalHotContentVersion(beforeArchive),
      })
      const hourlyBars = aggregateChartTimeframe(beforeArchiveBars, "1h")
      if (!hourlyBars.length) throw new Error("Verified raw archive produced no deterministic 1h cache bars")
      const cached = await upsertDerivedHourlyBars(supabase, {
        ticker: partition.ticker,
        bars: hourlyBars,
        sourceManifestId: archived.manifestId,
        sourceSha256: archived.sha256,
        sourceRangeStart: beforeArchiveBars[0].time,
        sourceRangeEnd: beforeArchiveBars.at(-1)!.time,
        sourceRawRowCount: archived.rowCount,
        generatedAt: referenceAt.toISOString(),
      })
      const beforePrune = await readPartition(supabase, partition, cutoff)
      if (!sameSnapshots(beforeArchive, beforePrune)) throw new Error("Chart hot partition changed during archive/cache verification; prune proof revalidation aborted")
      const deletedRows = await pruneVerifiedHotIntradayPartition(supabase, {
        manifestId: archived.manifestId,
        sha256: archived.sha256,
        rowCount: archived.rowCount,
        canonicalContentDigest: canonicalHotContentDigest(beforeArchive),
        canonicalContentVersion: canonicalHotContentVersion(beforeArchive),
        newerTradingDates: retentionProof.newerTradingDates,
      })
      if (deletedRows.status === "deferred") {
        deferred.push({
          ticker: partition.ticker,
          tradingDate: partition.tradingDate,
          reason: deletedRows.reason ?? "content_mismatch",
          newerTradingDates: retentionProof.newerTradingDates,
          rowsScanned: retentionProof.rowsScanned,
          pagesRead: retentionProof.pagesRead,
        })
        continue
      }
      const reclaim = await dropEmptyHotIntradaySessionPartition(supabase, partition.tradingDate)
      if (reclaim?.status === "dropped") sessionPartitionsDropped += 1
      partitionsArchived += 1
      if (archived.reused) reusedArchives += 1
      rowsArchived += archived.rowCount
      bytesWritten += archived.byteCount
      hourlyRowsCached += cached.rowCount
      rowsPruned += deletedRows.deletedRows
    } catch (cause) {
      failures.push(failure(partition, cause))
    }
  }

  const oldestHotEpoch = await readOldestHotIntradayTime(supabase)
  const uncertainDeferrals = deferred.filter((item) => item.reason !== "fewer_newer_trading_sessions")
  const status = partitions.length === 0
    ? "skipped"
    : failures.length > 0 || uncertainDeferrals.length > 0
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
    hourlyRowsCached,
    rowsPruned,
    sessionPartitionsDropped,
    failures,
    partitionsDeferred: deferred.length,
    deferred,
    oldestHotBar: oldestHotEpoch == null ? null : new Date(oldestHotEpoch * 1000).toISOString(),
  }
}
