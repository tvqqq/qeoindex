import "server-only"

import { createHash, randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { hasVietnamSecuritiesTradingCalendarCoverage, isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar"
import { listVerifiedColdManifests, type VerifiedColdManifest } from "./cold-store"
import type { CanonicalOhlcvBar } from "./contract"

const UPSERT_CHUNK_SIZE = 500
const MANIFEST_ID_CHUNK_SIZE = 100
export const DERIVED_HOURLY_AGGREGATION_VERSION = "vn-session-v1"

export interface DerivedHourlySourceProof {
  sourceManifestId: string
  sourceSha256: string
  sourceRangeStart: number
  sourceRangeEnd: number
  sourceRawRowCount: number
  sourceFormatVersion: number
  sourceCanonicalContentDigest?: string | null
  sourceCanonicalContentVersion?: number | null
}

export type DerivedHourlyReadinessReason = "ready" | "unknown" | "source_missing" | "source_mismatch" | "stale_version" | "content_mismatch"

export interface DerivedHourlyManifestReadiness {
  manifestId: string
  ready: boolean
  reason: DerivedHourlyReadinessReason
}

type StoredDerivedRow = {
  bar_time?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
  source_manifest_id?: unknown
  source_sha256?: unknown
  source_range_start?: unknown
  source_range_end?: unknown
  source_raw_row_count?: unknown
  source_format_version?: unknown
  source_canonical_content_digest?: unknown
  source_canonical_content_version?: unknown
  aggregation_version?: unknown
  generation_id?: unknown
  content_digest?: unknown
}

interface DerivedGenerationRow {
  bar: CanonicalOhlcvBar
  sourceManifestId: string
  sourceSha256: string
  sourceRangeStart: number
  sourceRangeEnd: number
  sourceRawRowCount: number
  sourceFormatVersion: number
  sourceCanonicalContentDigest: string | null
  sourceCanonicalContentVersion: number | null
  aggregationVersion: string
  generationId: string
  contentDigest: string
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function epoch(value: unknown) {
  const timestamp = value ? new Date(String(value)).getTime() : NaN
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

function nullableString(value: unknown) {
  return value == null || value === "" ? null : String(value)
}

function nullablePositiveInteger(value: unknown) {
  if (value == null || value === "") return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
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

function storedRowToGeneration(row: StoredDerivedRow): DerivedGenerationRow | null {
  const bar = storedRowToBar(row)
  const sourceManifestId = String(row.source_manifest_id || "")
  const sourceSha256 = String(row.source_sha256 || "")
  const sourceRangeStart = epoch(row.source_range_start)
  const sourceRangeEnd = epoch(row.source_range_end)
  const sourceRawRowCount = nullablePositiveInteger(row.source_raw_row_count)
  const sourceFormatVersion = nullablePositiveInteger(row.source_format_version)
  const sourceCanonicalContentDigest = nullableString(row.source_canonical_content_digest)
  const sourceCanonicalContentVersion = nullablePositiveInteger(row.source_canonical_content_version)
  const aggregationVersion = String(row.aggregation_version || "")
  const generationId = String(row.generation_id || "")
  const contentDigest = String(row.content_digest || "")
  if (!bar || !sourceManifestId || !/^[a-f0-9]{64}$/.test(sourceSha256) || sourceRangeStart == null || sourceRangeEnd == null) return null
  if (sourceRawRowCount == null || sourceFormatVersion == null || aggregationVersion !== DERIVED_HOURLY_AGGREGATION_VERSION) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generationId)) return null
  if (!/^[a-f0-9]{64}$/.test(contentDigest)) return null
  if (sourceCanonicalContentDigest != null && !/^[a-f0-9]{64}$/.test(sourceCanonicalContentDigest)) return null
  return {
    bar,
    sourceManifestId,
    sourceSha256,
    sourceRangeStart,
    sourceRangeEnd,
    sourceRawRowCount,
    sourceFormatVersion,
    sourceCanonicalContentDigest,
    sourceCanonicalContentVersion,
    aggregationVersion,
    generationId,
    contentDigest,
  }
}

function sameBars(left: CanonicalOhlcvBar[], right: CanonicalOhlcvBar[]) {
  if (left.length !== right.length) return false
  return left.every((bar, index) => {
    const other = right[index]
    return other
      && bar.time === other.time
      && bar.open === other.open
      && bar.high === other.high
      && bar.low === other.low
      && bar.close === other.close
      && bar.volume === other.volume
  })
}

function sameSource(row: DerivedGenerationRow, input: DerivedHourlySourceProof) {
  return row.sourceManifestId === input.sourceManifestId
    && row.sourceSha256 === input.sourceSha256
    && row.sourceRangeStart === input.sourceRangeStart
    && row.sourceRangeEnd === input.sourceRangeEnd
    && row.sourceRawRowCount === input.sourceRawRowCount
    && row.sourceFormatVersion === input.sourceFormatVersion
    && row.sourceCanonicalContentDigest === (input.sourceCanonicalContentDigest ?? null)
    && row.sourceCanonicalContentVersion === (input.sourceCanonicalContentVersion ?? null)
    && row.aggregationVersion === DERIVED_HOURLY_AGGREGATION_VERSION
}

function aggregateContentDigest(rows: DerivedGenerationRow[]) {
  if (!rows.length) throw new Error("Cannot prove an empty derived hourly generation")
  const sorted = [...rows].sort((left, right) => left.bar.time - right.bar.time)
  return createHash("sha256").update(sorted.map((row) => row.contentDigest).join(""), "utf8").digest("hex")
}

function vietnamSessionStart(dateKey: string, hour: number, minute = 0) {
  return Math.floor(new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`).getTime() / 1000)
}

function nextVietnamDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return vietnamDateKey(date)
}

function requiredTradingDates(from: number, to: number): string[] | null {
  const required: string[] = []
  let dateKey = vietnamDateKey(from * 1000)
  const last = vietnamDateKey(to * 1000)
  while (dateKey <= last) {
    if (!hasVietnamSecuritiesTradingCalendarCoverage(dateKey)) return null
    if (isVietnamSecuritiesTradingDateKey(dateKey)) {
      const morningFrom = vietnamSessionStart(dateKey, 9)
      const morningTo = vietnamSessionStart(dateKey, 11, 30) - 1
      const afternoonFrom = vietnamSessionStart(dateKey, 13)
      const afternoonTo = vietnamSessionStart(dateKey, 15) - 1
      if ((from <= morningTo && to >= morningFrom) || (from <= afternoonTo && to >= afternoonFrom)) required.push(dateKey)
    }
    dateKey = nextVietnamDateKey(dateKey)
  }
  return required
}

export function derivedHourlySourceProof(manifest: VerifiedColdManifest): DerivedHourlySourceProof {
  return {
    sourceManifestId: manifest.id,
    sourceSha256: manifest.sha256,
    sourceRangeStart: manifest.rangeStart,
    sourceRangeEnd: manifest.rangeEnd,
    sourceRawRowCount: manifest.rowCount,
    sourceFormatVersion: manifest.formatVersion,
    sourceCanonicalContentDigest: manifest.canonicalContentDigest,
    sourceCanonicalContentVersion: manifest.canonicalContentVersion,
  }
}

export async function validateDerivedHourlyManifestReadiness(
  supabase: SupabaseClient,
  manifestIds: string[],
): Promise<Map<string, DerivedHourlyManifestReadiness>> {
  const uniqueIds = [...new Set(manifestIds.filter(Boolean))]
  const readiness = new Map<string, DerivedHourlyManifestReadiness>()
  for (let offset = 0; offset < uniqueIds.length; offset += MANIFEST_ID_CHUNK_SIZE) {
    const ids = uniqueIds.slice(offset, offset + MANIFEST_ID_CHUNK_SIZE)
    const { data, error } = await supabase.rpc("qeo_validate_chart_derived_hourly_manifests", { p_manifest_ids: ids })
    if (error) throw new Error(`Chart derived hourly readiness validation failed: ${error.message}`)
    for (const raw of (data || []) as Array<Record<string, unknown>>) {
      const manifestId = String(raw.manifest_id || "")
      const reason = String(raw.reason || "unknown") as DerivedHourlyReadinessReason
      if (manifestId) readiness.set(manifestId, { manifestId, ready: raw.ready === true, reason })
    }
  }
  for (const id of uniqueIds) if (!readiness.has(id)) readiness.set(id, { manifestId: id, ready: false, reason: "unknown" })
  return readiness
}

export async function readDerivedHourlyRange(
  supabase: SupabaseClient,
  ticker: string,
  from: number,
  to: number,
): Promise<CanonicalOhlcvBar[]> {
  if (to < from) return []
  const { data, error } = await supabase.from("chart_ohlcv_derived_hourly")
    .select("bar_time,open,high,low,close,volume")
    .eq("ticker", ticker).eq("resolution", "1h")
    .gte("bar_time", new Date(from * 1000).toISOString()).lte("bar_time", new Date(to * 1000).toISOString())
    .order("bar_time", { ascending: true })
  if (error) throw new Error(`Chart derived hourly read failed: ${error.message}`)
  const bars = ((data || []) as StoredDerivedRow[]).map(storedRowToBar).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
  if (!(await derivedHourlyColdCoverageComplete(supabase, { ticker, from, to }))) {
    throw new Error("Chart derived hourly readiness changed during read")
  }
  return bars
}

export async function readDerivedHourlyByManifest(
  supabase: SupabaseClient,
  manifestId: string,
): Promise<CanonicalOhlcvBar[]> {
  const { data, error } = await supabase.from("chart_ohlcv_derived_hourly")
    .select("bar_time,open,high,low,close,volume")
    .eq("source_manifest_id", manifestId).eq("resolution", "1h")
    .order("bar_time", { ascending: true })
  if (error) throw new Error(`Chart derived hourly manifest read failed: ${error.message}`)
  return ((data || []) as StoredDerivedRow[]).map(storedRowToBar).filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
}

async function readDerivedHourlyGenerationByManifest(
  supabase: SupabaseClient,
  manifestId: string,
): Promise<DerivedGenerationRow[]> {
  const { data, error } = await supabase.from("chart_ohlcv_derived_hourly")
    .select("bar_time,open,high,low,close,volume,source_manifest_id,source_sha256,source_range_start,source_range_end,source_raw_row_count,source_format_version,source_canonical_content_digest,source_canonical_content_version,aggregation_version,generation_id,content_digest")
    .eq("source_manifest_id", manifestId).eq("resolution", "1h")
    .order("bar_time", { ascending: true })
  if (error) throw new Error(`Chart derived hourly generation read failed: ${error.message}`)
  const rows = ((data || []) as StoredDerivedRow[]).map(storedRowToGeneration)
  if (rows.some((row) => row == null)) throw new Error(`Chart derived hourly generation contains unknown proof rows: ${manifestId}`)
  return rows.filter((row): row is DerivedGenerationRow => Boolean(row))
}

export async function derivedHourlyColdCoverageComplete(
  supabase: SupabaseClient,
  input: { ticker: string; from: number; to: number },
): Promise<boolean> {
  if (input.to < input.from) return true
  const requiredDates = requiredTradingDates(input.from, input.to)
  if (requiredDates == null) return false
  const manifests = await listVerifiedColdManifests(supabase, {
    ticker: input.ticker,
    from: input.from,
    to: input.to,
    baseResolution: "1m",
  })
  if (!manifests.length) return requiredDates.length === 0

  const datesWithManifest = new Set(manifests.map((manifest) => vietnamDateKey(manifest.rangeStart * 1000)))
  if (requiredDates.some((dateKey) => !datesWithManifest.has(dateKey))) return false

  const readiness = await validateDerivedHourlyManifestReadiness(supabase, manifests.map((manifest) => manifest.id))
  return manifests.every((manifest) => readiness.get(manifest.id)?.ready === true)
}

export async function upsertDerivedHourlyBars(
  supabase: SupabaseClient,
  input: DerivedHourlySourceProof & {
    ticker: string
    bars: CanonicalOhlcvBar[]
    generationId: string
    generatedAt: string
  },
) {
  if (!input.bars.length) throw new Error("Cannot cache an empty derived hourly partition")
  const sorted = [...input.bars].sort((a, b) => a.time - b.time)
  const { error: clearError } = await supabase.from("chart_ohlcv_derived_hourly")
    .delete()
    .eq("source_manifest_id", input.sourceManifestId)
  if (clearError) throw new Error(`Chart derived hourly generation reset failed: ${clearError.message}`)

  const rows = sorted.map((bar) => ({
    ticker: input.ticker,
    resolution: "1h",
    bar_time: new Date(bar.time * 1000).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    source_manifest_id: input.sourceManifestId,
    source_sha256: input.sourceSha256,
    source_range_start: new Date(input.sourceRangeStart * 1000).toISOString(),
    source_range_end: new Date(input.sourceRangeEnd * 1000).toISOString(),
    source_raw_row_count: input.sourceRawRowCount,
    source_format_version: input.sourceFormatVersion,
    source_canonical_content_digest: input.sourceCanonicalContentDigest ?? null,
    source_canonical_content_version: input.sourceCanonicalContentVersion ?? null,
    aggregation_version: DERIVED_HOURLY_AGGREGATION_VERSION,
    generation_id: input.generationId,
    generated_at: input.generatedAt,
  }))
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const { error } = await supabase.from("chart_ohlcv_derived_hourly")
      .upsert(rows.slice(offset, offset + UPSERT_CHUNK_SIZE), { onConflict: "ticker,resolution,bar_time" })
    if (error) throw new Error(`Chart derived hourly upsert failed: ${error.message}`)
  }
  return { rowCount: rows.length, generationId: input.generationId }
}

export async function persistVerifiedDerivedHourlyGeneration(
  supabase: SupabaseClient,
  input: DerivedHourlySourceProof & {
    ticker: string
    bars: CanonicalOhlcvBar[]
    generatedAt?: string
  },
) {
  if (!input.bars.length) throw new Error("Cannot publish an empty derived hourly generation")
  const generationId = randomUUID()
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const expectedBars = [...input.bars].sort((a, b) => a.time - b.time)
  await upsertDerivedHourlyBars(supabase, { ...input, bars: expectedBars, generationId, generatedAt })

  const persisted = await readDerivedHourlyGenerationByManifest(supabase, input.sourceManifestId)
  if (persisted.length !== expectedBars.length
    || !sameBars(persisted.map((row) => row.bar), expectedBars)
    || persisted.some((row) => row.generationId !== generationId || !sameSource(row, input))) {
    throw new Error(`Chart derived hourly generation readback mismatch: ${input.sourceManifestId}`)
  }
  const derivedContentDigest = aggregateContentDigest(persisted)

  const { data, error } = await supabase.rpc("qeo_publish_chart_derived_hourly_readiness", {
    p_manifest_id: input.sourceManifestId,
    p_expected_sha256: input.sourceSha256,
    p_expected_range_start: new Date(input.sourceRangeStart * 1000).toISOString(),
    p_expected_range_end: new Date(input.sourceRangeEnd * 1000).toISOString(),
    p_expected_raw_row_count: input.sourceRawRowCount,
    p_expected_format_version: input.sourceFormatVersion,
    p_expected_canonical_content_digest: input.sourceCanonicalContentDigest ?? null,
    p_expected_canonical_content_version: input.sourceCanonicalContentVersion ?? null,
    p_aggregation_version: DERIVED_HOURLY_AGGREGATION_VERSION,
    p_generation_id: generationId,
    p_expected_derived_row_count: expectedBars.length,
    p_expected_derived_content_digest: derivedContentDigest,
  })
  if (error) throw new Error(`Chart derived hourly readiness publication failed: ${error.message}`)
  const raw = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {}
  if (raw.status !== "ready" || String(raw.generationId || "") !== generationId || Number(raw.derivedRowCount) !== expectedBars.length) {
    throw new Error(`Chart derived hourly readiness publication returned invalid proof: ${input.sourceManifestId}`)
  }

  const readiness = await validateDerivedHourlyManifestReadiness(supabase, [input.sourceManifestId])
  if (readiness.get(input.sourceManifestId)?.ready !== true) throw new Error(`Chart derived hourly readiness post-check failed: ${input.sourceManifestId}`)
  return { rowCount: expectedBars.length, generationId, derivedContentDigest }
}
