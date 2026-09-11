import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"
import { persistVerifiedDerivedHourlyGeneration } from "./derived-hourly-store"
import { chartHotSessionRetentionCutoff } from "./history-policy"
import {
  abandonChartIntradayRange,
  canonicalProviderRangeContentId,
  claimChartIntradayRange,
  completeChartIntradayRange,
  recordChartProviderAttempt,
} from "./hot-store"
import {
  ChartOhlcvProviderWaterfallError,
  createPrimaryChartOhlcvProvider,
  normalizeChartProviderResult,
  type ChartOhlcvProvider,
} from "./provider"
import { CHART_PROVIDER_SOURCE_KEY, runClosedRangeIngestion } from "./provider-ingestion"
import { aggregateChartTimeframe } from "./timeframes"

const DAY_SECONDS = 86_400
export const MAX_HISTORICAL_CHART_BACKFILL_SECONDS = 31 * DAY_SECONDS

export interface HistoricalChartBackfillResult {
  status: "succeeded" | "skipped" | "provider_gap" | "retryable_failure" | "failed"
  ticker: string
  from: number
  to: number
  provider: string | null
  fetchedRows: number
  archivedPartitions: number
  reusedArchives: number
  derivedHourlyRows: number
  error: string | null
}

function validTicker(value: string) {
  const ticker = String(value || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Historical chart backfill requires a valid ticker")
  return ticker
}

function vietnamDateKey(epochSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000))
}

function partitionByVietnamDate(bars: CanonicalOhlcvBar[]) {
  const groups = new Map<string, CanonicalOhlcvBar[]>()
  for (const bar of bars) {
    const key = vietnamDateKey(bar.time)
    const current = groups.get(key) ?? []
    current.push(bar)
    groups.set(key, current)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tradingDate, rows]) => ({ tradingDate, bars: rows.sort((left, right) => left.time - right.time) }))
}

function baseResult(ticker: string, from: number, to: number): HistoricalChartBackfillResult {
  return {
    status: "failed",
    ticker,
    from,
    to,
    provider: null,
    fetchedRows: 0,
    archivedPartitions: 0,
    reusedArchives: 0,
    derivedHourlyRows: 0,
    error: null,
  }
}

export async function backfillChartIntradayHistoricalChunk(
  supabase: SupabaseClient,
  input: {
    ticker: string
    from: number
    to: number
    referenceAt?: Date
    provider?: ChartOhlcvProvider
  },
): Promise<HistoricalChartBackfillResult> {
  const ticker = validTicker(input.ticker)
  const from = Math.floor(input.from)
  const to = Math.floor(input.to)
  const referenceAt = input.referenceAt ?? new Date()
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from) {
    throw new Error("Historical chart backfill requires a valid epoch range")
  }
  if (to - from > MAX_HISTORICAL_CHART_BACKFILL_SECONDS) {
    throw new Error("Historical chart backfill range exceeds 31 days")
  }
  const hotCutoff = chartHotSessionRetentionCutoff(referenceAt)
  if (to >= hotCutoff) {
    throw new Error("Historical chart backfill must end before the current five-session HOT retention window")
  }

  const provider = input.provider ?? createPrimaryChartOhlcvProvider()
  const coordinator = {
    claim: (claimInput: Parameters<typeof claimChartIntradayRange>[1]) => claimChartIntradayRange(supabase, claimInput),
    complete: (completionInput: Parameters<typeof completeChartIntradayRange>[1]) => completeChartIntradayRange(supabase, completionInput),
    abandon: (abandonInput: Parameters<typeof abandonChartIntradayRange>[1]) => abandonChartIntradayRange(supabase, abandonInput),
  }

  try {
    const coordinated = await runClosedRangeIngestion({
      ticker,
      sourceKey: CHART_PROVIDER_SOURCE_KEY,
      from,
      to,
    }, coordinator, async () => {
      let providerResult
      try {
        providerResult = normalizeChartProviderResult(await provider.fetch({
          ticker,
          resolution: "1m",
          from,
          to,
          includeCurrent: false,
        }), "CUSTOM")
      } catch (cause) {
        if (cause instanceof ChartOhlcvProviderWaterfallError) {
          throw new Error(`Historical chart provider waterfall failed: ${cause.message}`)
        }
        throw cause
      }

      const bars = providerResult.bars
        .filter((bar) => bar.time >= from && bar.time <= to)
        .sort((left, right) => left.time - right.time)
      if (!bars.length) throw new Error(`${providerResult.provider} returned no historical 1m bars`)

      const coldStorage = createSupabaseColdOhlcvStorage(supabase)
      let archivedPartitions = 0
      let reusedArchives = 0
      let derivedHourlyRows = 0
      for (const partition of partitionByVietnamDate(bars)) {
        const archived = await coldStorage.archiveVerifiedPartition({ ticker, bars: partition.bars })
        const hourlyBars = aggregateChartTimeframe(partition.bars, "1h")
        if (!hourlyBars.length) throw new Error(`Historical chart backfill ${ticker} ${partition.tradingDate} produced no deterministic 1h bars`)
        const cached = await persistVerifiedDerivedHourlyGeneration(supabase, {
          ticker,
          bars: hourlyBars,
          sourceManifestId: archived.manifestId,
          sourceSha256: archived.sha256,
          sourceRangeStart: partition.bars[0].time,
          sourceRangeEnd: partition.bars.at(-1)!.time,
          sourceRawRowCount: archived.rowCount,
          sourceFormatVersion: 1,
          sourceCanonicalContentDigest: null,
          sourceCanonicalContentVersion: null,
          generatedAt: referenceAt.toISOString(),
        })
        archivedPartitions += 1
        if (archived.reused) reusedArchives += 1
        derivedHourlyRows += cached.rowCount
      }

      const provenance = await recordChartProviderAttempt(supabase, {
        ticker,
        provider: providerResult.provider,
        requestedFrom: from,
        requestedTo: to,
        bars,
        fetchedAt: referenceAt.toISOString(),
        detail: {
          workflow: "QEO-172-HISTORICAL-BACKFILL",
          outcome: "success",
          actualFrom: bars[0].time,
          actualTo: bars.at(-1)!.time,
          archivedPartitions,
          reusedArchives,
          derivedHourlyRows,
        },
      })

      return {
        value: {
          status: "succeeded" as const,
          ticker,
          from,
          to,
          provider: providerResult.provider,
          fetchedRows: bars.length,
          archivedPartitions,
          reusedArchives,
          derivedHourlyRows,
          error: null,
        },
        completion: {
          provider: providerResult.provider,
          rowCount: bars.length,
          provenanceBatchId: provenance.batchId,
          contentId: canonicalProviderRangeContentId({
            provider: providerResult.provider,
            requestedFrom: from,
            requestedTo: to,
            bars,
          }),
        },
      }
    })

    if (coordinated.status === "completed") return coordinated.value
    if (coordinated.status === "reused") return { ...baseResult(ticker, from, to), status: "skipped", error: null }
    return {
      ...baseResult(ticker, from, to),
      status: "retryable_failure",
      error: "Historical chart backfill range is owned by another active lease",
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const status: HistoricalChartBackfillResult["status"] = /returned no historical 1m bars|provider waterfall/i.test(message)
      ? "provider_gap"
      : "failed"
    return { ...baseResult(ticker, from, to), status, error: message }
  }
}
