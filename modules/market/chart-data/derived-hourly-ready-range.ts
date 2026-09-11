import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { listVerifiedColdManifests, type VerifiedColdManifest } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"
import { validateDerivedHourlyManifestReadiness } from "./derived-hourly-store"

const MANIFEST_QUERY_CHUNK_SIZE = 100

type StoredDerivedRow = {
  bar_time?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
  source_manifest_id?: unknown
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function epoch(value: unknown) {
  const timestamp = value ? new Date(String(value)).getTime() : NaN
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

function storedRowToBar(row: StoredDerivedRow): CanonicalOhlcvBar | null {
  const time = epoch(row.bar_time)
  const open = finite(row.open)
  const high = finite(row.high)
  const low = finite(row.low)
  const close = finite(row.close)
  const volume = finite(row.volume)
  if (time == null || open == null || high == null || low == null || close == null || volume == null) return null
  return { time, open, high, low, close, volume }
}

async function listExistingManifests(
  supabase: SupabaseClient,
  input: { ticker: string; from: number; to: number },
): Promise<VerifiedColdManifest[]> {
  return listVerifiedColdManifests(supabase, {
    ticker: input.ticker,
    from: input.from,
    to: input.to,
    baseResolution: "1m",
  })
}

async function allReady(supabase: SupabaseClient, manifests: VerifiedColdManifest[]) {
  if (!manifests.length) return false
  const readiness = await validateDerivedHourlyManifestReadiness(supabase, manifests.map((manifest) => manifest.id))
  return manifests.every((manifest) => readiness.get(manifest.id)?.ready === true)
}

/**
 * This is deliberately weaker than derivedHourlyColdCoverageComplete: it only
 * answers whether every verified RAW manifest that currently exists in the
 * bounded range has a positive QEO-147 derived-generation proof. Missing
 * requested trading sessions remain a separate source-coverage concern and
 * therefore still force the public result to PARTIAL.
 */
export async function derivedHourlyExistingManifestsReady(
  supabase: SupabaseClient,
  input: { ticker: string; from: number; to: number },
): Promise<boolean> {
  if (input.to < input.from) return true
  const manifests = await listExistingManifests(supabase, input)
  return allReady(supabase, manifests)
}

/**
 * Reads only rows owned by the exact verified manifest IDs observed at the
 * start of the read, and revalidates those IDs afterwards. This prevents stale
 * derived rows from an obsolete/replaced manifest from entering the fast path.
 */
export async function readReadyDerivedHourlyRange(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<CanonicalOhlcvBar[]> {
  if (to < from) return []
  const manifests = await listExistingManifests(supabase, { ticker, from, to })
  if (!manifests.length) return []
  if (!(await allReady(supabase, manifests))) throw new Error("Chart derived hourly existing-manifest readiness is not positive")

  const manifestIds = manifests.map((manifest) => manifest.id)
  const allowedManifestIds = new Set(manifestIds)
  const barsByTime = new Map<number, CanonicalOhlcvBar>()

  for (let offset = 0; offset < manifestIds.length; offset += MANIFEST_QUERY_CHUNK_SIZE) {
    const ids = manifestIds.slice(offset, offset + MANIFEST_QUERY_CHUNK_SIZE)
    const { data, error } = await supabase.from("chart_ohlcv_derived_hourly")
      .select("bar_time,open,high,low,close,volume,source_manifest_id")
      .in("source_manifest_id", ids)
      .eq("ticker", ticker).eq("resolution", "1h")
      .gte("bar_time", new Date(from * 1000).toISOString()).lte("bar_time", new Date(to * 1000).toISOString())
      .order("bar_time", { ascending: true })
    if (error) throw new Error(`Chart ready derived hourly read failed: ${error.message}`)
    for (const row of (data || []) as StoredDerivedRow[]) {
      if (!allowedManifestIds.has(String(row.source_manifest_id || ""))) continue
      const bar = storedRowToBar(row)
      if (bar) barsByTime.set(bar.time, bar)
    }
  }

  const postRead = await validateDerivedHourlyManifestReadiness(supabase, manifestIds)
  if (manifests.some((manifest) => postRead.get(manifest.id)?.ready !== true)) {
    throw new Error("Chart derived hourly readiness changed during partial-range read")
  }

  return [...barsByTime.values()].sort((left, right) => left.time - right.time)
}
