import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getCanonicalUniverse } from "@/lib/market-universe"
import {
  WYCKOFF_V2_AGGREGATION_VERSION,
  WYCKOFF_V2_MODEL_VERSION,
  WYCKOFF_V2_PROMPT_VERSION,
  type WyckoffV2Snapshot,
} from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2ChartSeriesRows } from "@/lib/wyckoff-v2-chart-series"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "@/lib/wyckoff-v2-contract"
import { buildWyckoffV2SupabasePayload, WYCKOFF_V2_UNIVERSE_KEY } from "@/lib/wyckoff-v2-ingest"

export const WYCKOFF_SUPABASE_DIRECT_SOURCE = "qeoindex-supabase-v3" as const

function normalizedTickers(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))].sort()
}

function assertExactCanonicalMembership(canonicalTickers: string[], snapshotTickers: string[]) {
  const canonical = normalizedTickers(canonicalTickers)
  const snapshots = normalizedTickers(snapshotTickers)
  const canonicalSet = new Set(canonical)
  const snapshotSet = new Set(snapshots)
  const missing = canonical.filter((ticker) => !snapshotSet.has(ticker))
  const unexpected = snapshots.filter((ticker) => !canonicalSet.has(ticker))
  if (canonical.length !== snapshots.length || missing.length || unexpected.length) {
    throw new Error(
      `Canonical Wyckoff membership mismatch: snapshots=${snapshots.length}/${canonical.length}`
      + `${missing.length ? `; missing=${missing.slice(0, 20).join(",")}` : ""}`
      + `${unexpected.length ? `; unexpected=${unexpected.slice(0, 20).join(",")}` : ""}`,
    )
  }
}

async function ensureOperationalRun(
  supabase: SupabaseClient,
  input: {
    runId: string
    runKey: string
    scanDate: string
    tickerCount: number
    complete: number
    incomplete: number
    validationHash: string
    universeRunId: string
  },
) {
  const existing = await supabase.from("wyckoff_scan_runs").select("id,status").eq("id", input.runId).maybeSingle()
  if (existing.error) throw new Error(`Supabase Wyckoff run lookup failed: ${existing.error.message}`)
  if (existing.data?.status === "published") return "published" as const
  if (existing.data && existing.data.status !== "running") {
    throw new Error(`Supabase Wyckoff run ${input.runId} is ${existing.data.status}; expected running/published`)
  }
  if (!existing.data) {
    const inserted = await supabase.from("wyckoff_scan_runs").insert({
      id: input.runId,
      universe_key: WYCKOFF_V2_UNIVERSE_KEY,
      universe_effective_date: input.scanDate,
      model_version: WYCKOFF_V2_MODEL_VERSION,
      aggregation_version: WYCKOFF_V2_AGGREGATION_VERSION,
      prompt_version: WYCKOFF_V2_PROMPT_VERSION,
      status: "running",
      requested_count: input.tickerCount,
      completed_count: 0,
      incomplete_count: input.incomplete,
      error_count: 0,
      diagnostics: {
        source: WYCKOFF_SUPABASE_DIRECT_SOURCE,
        runKey: input.runKey,
        universeRunId: input.universeRunId,
        validationHash: input.validationHash,
        completeSnapshots: input.complete,
        incompleteSnapshots: input.incomplete,
        tickerCount: input.tickerCount,
      },
      started_at: new Date().toISOString(),
    })
    if (inserted.error) throw new Error(`Supabase Wyckoff run insert failed: ${inserted.error.message}`)
  }
  return "running" as const
}

export async function publishWyckoffV2SnapshotsDirect(
  supabase: SupabaseClient,
  input: {
    snapshots: WyckoffV2Snapshot[]
    runKey: string
    scanDate: string
    runId?: string
  },
) {
  const validation = validateWyckoffV2SnapshotSet(input.runKey, input.snapshots)
  const validationHash = computeWyckoffV2ValidationHash(input.snapshots)
  const canonical = await getCanonicalUniverse()
  const runId = input.runId || randomUUID()
  const payload = buildWyckoffV2SupabasePayload({
    snapshots: input.snapshots,
    runId,
    scanDate: input.scanDate,
    runKey: input.runKey,
  })
  const tickers = payload.memberships.map((row) => row.ticker)
  assertExactCanonicalMembership(canonical.stocks.map((stock) => stock.ticker), tickers)
  if (canonical.selectedCount !== tickers.length) {
    throw new Error(`Canonical Wyckoff membership mismatch: selectedCount=${canonical.selectedCount}; snapshots=${tickers.length}`)
  }

  const expectedSnapshots = tickers.length * 5
  if (validation.total !== expectedSnapshots || payload.snapshots.length !== expectedSnapshots) {
    throw new Error(`Supabase Wyckoff validation mismatch: ${validation.total}/${expectedSnapshots} snapshots`)
  }

  const chartSeries = await loadWyckoffV2ChartSeriesRows(supabase, tickers, runId)
  const expectedSeriesCount = tickers.length * 2
  if (chartSeries.length !== expectedSeriesCount) {
    throw new Error(`Expected ${expectedSeriesCount} Wyckoff chart series; received ${chartSeries.length}`)
  }

  const runState = await ensureOperationalRun(supabase, {
    runId,
    runKey: input.runKey,
    scanDate: input.scanDate,
    tickerCount: tickers.length,
    complete: payload.complete,
    incomplete: payload.incomplete,
    validationHash,
    universeRunId: canonical.runId,
  })
  if (runState === "published") {
    return {
      ok: true as const,
      status: "published" as const,
      runId,
      runKey: input.runKey,
      universeRunId: canonical.runId,
      tickerCount: tickers.length,
      complete: payload.complete,
      incomplete: payload.incomplete,
      snapshotCount: payload.snapshots.length,
      chartSeriesCount: chartSeries.length,
      validationHash,
    }
  }

  try {
    const now = new Date().toISOString()
    const membershipRows = payload.memberships.map((row) => ({
      ...row,
      source: WYCKOFF_SUPABASE_DIRECT_SOURCE,
      synced_at: now,
    }))
    const memberships = await supabase
      .from("wyckoff_universe_memberships")
      .upsert(membershipRows, { onConflict: "universe_key,ticker,effective_date" })
    if (memberships.error) throw new Error(`Supabase Wyckoff membership upsert failed: ${memberships.error.message}`)

    for (let offset = 0; offset < payload.snapshots.length; offset += 100) {
      const rows = payload.snapshots.slice(offset, offset + 100).map((row) => ({ id: randomUUID(), ...row }))
      const written = await supabase.from("wyckoff_analysis_snapshots").upsert(rows, {
        onConflict: "ticker,timeframe,bar_closed_at,model_version,aggregation_version,prompt_version",
        ignoreDuplicates: true,
      })
      if (written.error) throw new Error(`Supabase Wyckoff snapshot upsert failed: ${written.error.message}`)
    }

    const seriesWrite = await supabase.from("wyckoff_chart_series").upsert(chartSeries, { onConflict: "ticker,timeframe" })
    if (seriesWrite.error) throw new Error(`Supabase Wyckoff chart-series upsert failed: ${seriesWrite.error.message}`)

    const seriesVerify = await supabase
      .from("wyckoff_chart_series")
      .select("ticker,timeframe")
      .eq("run_id", runId)
      .in("ticker", tickers)
      .in("timeframe", ["1H", "1D"])
    if (seriesVerify.error) throw new Error(`Supabase Wyckoff chart-series verification failed: ${seriesVerify.error.message}`)
    const publishedSeriesKeys = new Set((seriesVerify.data || []).map((row) => `${row.ticker}|${row.timeframe}`))
    if (publishedSeriesKeys.size !== expectedSeriesCount) {
      throw new Error(`Expected ${expectedSeriesCount} persisted Wyckoff chart series; received ${publishedSeriesKeys.size}`)
    }

    const finishedAt = new Date().toISOString()
    const publish = await supabase.from("wyckoff_scan_runs").update({
      status: "published",
      completed_count: tickers.length,
      incomplete_count: payload.incomplete,
      error_count: 0,
      diagnostics: {
        source: WYCKOFF_SUPABASE_DIRECT_SOURCE,
        runKey: input.runKey,
        universeRunId: canonical.runId,
        validationHash,
        completeSnapshots: payload.complete,
        incompleteSnapshots: payload.incomplete,
        snapshotCount: payload.snapshots.length,
        chartSeriesCount: chartSeries.length,
        tickerCount: tickers.length,
      },
      finished_at: finishedAt,
    }).eq("id", runId).eq("status", "running")
    if (publish.error) throw new Error(`Supabase Wyckoff run publish failed: ${publish.error.message}`)

    return {
      ok: true as const,
      status: "published" as const,
      runId,
      runKey: input.runKey,
      universeRunId: canonical.runId,
      tickerCount: tickers.length,
      complete: payload.complete,
      incomplete: payload.incomplete,
      snapshotCount: payload.snapshots.length,
      chartSeriesCount: chartSeries.length,
      validationHash,
    }
  } catch (error) {
    await supabase.from("wyckoff_scan_runs").update({
      status: "failed",
      error_count: 1,
      diagnostics: {
        source: WYCKOFF_SUPABASE_DIRECT_SOURCE,
        runKey: input.runKey,
        universeRunId: canonical.runId,
        validationHash,
        error: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      },
      finished_at: new Date().toISOString(),
    }).eq("id", runId).eq("status", "running")
    throw error
  }
}
