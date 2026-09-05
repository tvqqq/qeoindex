import "server-only"

import { createHash } from "node:crypto"
import { gzipSync, gunzipSync } from "node:zlib"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"

const BUCKET = "chart-ohlcv"
const ARCHIVE_FORMAT_VERSION = 1
const VERIFIED_MANIFEST_READ_LIMIT = 1_000

type ColdBaseResolution = "1m" | "1D"

type ManifestRow = {
  id?: unknown
  ticker?: unknown
  base_resolution?: unknown
  object_path?: unknown
  range_start?: unknown
  range_end?: unknown
  row_count?: unknown
  sha256?: unknown
  archive_format?: unknown
  verified_at?: unknown
  format_version?: unknown
  byte_count?: unknown
}

export interface VerifiedColdManifest {
  id: string
  ticker: string
  baseResolution: ColdBaseResolution
  objectPath: string
  rangeStart: number
  rangeEnd: number
  rowCount: number
  sha256: string
  archiveFormat: "ndjson.gz"
  formatVersion: number
  byteCount: number | null
}

export interface ColdReadResult {
  bars: CanonicalOhlcvBar[]
  manifestsRead: number
}

export interface ColdArchiveResult {
  manifestId: string
  objectPath: string
  sha256: string
  rowCount: number
  byteCount: number
  reused: boolean
}

export interface ColdOhlcvStorage {
  readIntersectingRange(input: { ticker: string; from: number; to: number }): Promise<ColdReadResult>
  archiveVerifiedPartition(input: {
    ticker: string
    bars: CanonicalOhlcvBar[]
    provenanceBatchId?: string | null
    provenance?: Record<string, unknown>
  }): Promise<ColdArchiveResult>
}

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function serializeBars(bars: CanonicalOhlcvBar[]) {
  const text = bars.slice().sort((a, b) => a.time - b.time).map((bar) => JSON.stringify({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume })).join("\n") + "\n"
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 })
}

function deserializeBars(bytes: Uint8Array): CanonicalOhlcvBar[] {
  const text = gunzipSync(bytes).toString("utf8")
  return text.split("\n").filter(Boolean).map((line) => {
    const raw = JSON.parse(line) as Record<string, unknown>
    return { time: Number(raw.time), open: Number(raw.open), high: Number(raw.high), low: Number(raw.low), close: Number(raw.close), volume: Number(raw.volume) }
  })
}

function archivePath(baseResolution: "1m" | "1D", ticker: string, bars: CanonicalOhlcvBar[], checksum: string) {
  const first = bars[0]
  const last = bars.at(-1)!
  const date = new Date(first.time * 1000)
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(date)
  const month = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", month: "2-digit" }).format(date)
  const partition = baseResolution === "1m" ? `/month=${month}` : ""
  return `${baseResolution}/ticker=${ticker}/year=${year}${partition}/${first.time}-${last.time}-${checksum}.ndjson.gz`
}

async function blobBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

async function verifyStoredObject(supabase: SupabaseClient, input: { objectPath: string; checksum: string; rowCount: number }) {
  const { data: object, error } = await supabase.storage.from(BUCKET).download(input.objectPath)
  if (error || !object) throw new Error(`Chart cold verification read failed: ${error?.message ?? "missing object"}`)
  const bytes = await blobBytes(object)
  if (hash(bytes) !== input.checksum) throw new Error("Chart cold verification checksum mismatch")
  if (deserializeBars(bytes).length !== input.rowCount) throw new Error("Chart cold verification row-count mismatch")
  return bytes
}

function finiteEpoch(value: unknown) {
  const timestamp = value ? new Date(String(value)).getTime() : NaN
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

function manifestFromRow(raw: ManifestRow): VerifiedColdManifest | null {
  const id = String(raw.id || "")
  const ticker = String(raw.ticker || "").trim().toUpperCase()
  const baseResolution = String(raw.base_resolution || "") as ColdBaseResolution
  const objectPath = String(raw.object_path || "")
  const rangeStart = finiteEpoch(raw.range_start)
  const rangeEnd = finiteEpoch(raw.range_end)
  const rowCount = Number(raw.row_count)
  const sha256 = String(raw.sha256 || "")
  const formatVersion = Number(raw.format_version ?? ARCHIVE_FORMAT_VERSION)
  const byteCountValue = raw.byte_count == null ? null : Number(raw.byte_count)
  if (!id || !ticker || (baseResolution !== "1m" && baseResolution !== "1D") || !objectPath || rangeStart == null || rangeEnd == null || rangeEnd < rangeStart) return null
  if (!Number.isInteger(rowCount) || rowCount <= 0 || !/^[a-f0-9]{64}$/.test(sha256)) return null
  if (raw.archive_format !== "ndjson.gz" || !raw.verified_at || formatVersion !== ARCHIVE_FORMAT_VERSION) return null
  if (byteCountValue != null && (!Number.isFinite(byteCountValue) || byteCountValue <= 0)) return null
  return {
    id,
    ticker,
    baseResolution,
    objectPath,
    rangeStart,
    rangeEnd,
    rowCount,
    sha256,
    archiveFormat: "ndjson.gz",
    formatVersion,
    byteCount: byteCountValue,
  }
}

export async function listVerifiedColdManifests(
  supabase: SupabaseClient,
  input: { ticker?: string; from?: number; to?: number; limit?: number; offset?: number; baseResolution?: ColdBaseResolution } = {},
): Promise<VerifiedColdManifest[]> {
  const limit = Math.max(1, Math.min(VERIFIED_MANIFEST_READ_LIMIT, Math.floor(input.limit ?? VERIFIED_MANIFEST_READ_LIMIT)))
  const offset = Math.max(0, Math.floor(input.offset ?? 0))
  const baseResolution = input.baseResolution ?? "1m"
  let query = supabase.from("chart_ohlcv_cold_manifests")
    .select("id,ticker,base_resolution,object_path,range_start,range_end,row_count,sha256,archive_format,verified_at,format_version,byte_count")
    .eq("base_resolution", baseResolution)
    .not("verified_at", "is", null)
    .order("range_start", { ascending: true })
    .range(offset, offset + limit - 1)
  if (input.ticker) query = query.eq("ticker", input.ticker)
  if (input.from != null) query = query.gte("range_end", new Date(input.from * 1000).toISOString())
  if (input.to != null) query = query.lte("range_start", new Date(input.to * 1000).toISOString())
  const { data, error } = await query
  if (error) throw new Error(`Chart verified cold manifest read failed: ${error.message}`)
  return ((data || []) as ManifestRow[]).map(manifestFromRow).filter((manifest): manifest is VerifiedColdManifest => Boolean(manifest))
}

export async function readVerifiedColdManifest(
  supabase: SupabaseClient,
  manifest: VerifiedColdManifest,
): Promise<{ bars: CanonicalOhlcvBar[]; byteCount: number }> {
  const bytes = await verifyStoredObject(supabase, {
    objectPath: manifest.objectPath,
    checksum: manifest.sha256,
    rowCount: manifest.rowCount,
  })
  const bars = deserializeBars(bytes).sort((a, b) => a.time - b.time)
  if (!bars.length || bars[0].time !== manifest.rangeStart || bars.at(-1)!.time !== manifest.rangeEnd) {
    throw new Error(`Chart verified cold manifest range mismatch: ${manifest.id}`)
  }
  return { bars, byteCount: bytes.byteLength }
}

function createResolutionColdOhlcvStorage(supabase: SupabaseClient, baseResolution: "1m" | "1D"): ColdOhlcvStorage {
  return {
    async readIntersectingRange({ ticker, from, to }) {
      const manifests = await listVerifiedColdManifests(supabase, { ticker, from, to, baseResolution })
      const bars: CanonicalOhlcvBar[] = []
      let manifestsRead = 0
      for (const manifest of manifests) {
        const verified = await readVerifiedColdManifest(supabase, manifest)
        bars.push(...verified.bars.filter((bar) => bar.time >= from && bar.time <= to))
        manifestsRead += 1
      }
      return { bars, manifestsRead }
    },

    async archiveVerifiedPartition({ ticker, bars, provenanceBatchId = null, provenance = {} }) {
      if (!bars.length) throw new Error("Cannot archive an empty chart partition")
      const sorted = [...bars].sort((a, b) => a.time - b.time)
      const bytes = serializeBars(sorted)
      const checksum = hash(bytes)
      const objectPath = archivePath(baseResolution, ticker, sorted, checksum)
      const rangeStart = new Date(sorted[0].time * 1000).toISOString()
      const rangeEnd = new Date(sorted.at(-1)!.time * 1000).toISOString()

      const { data: existingRows, error: lookupError } = await supabase.from("chart_ohlcv_cold_manifests")
        .select("id,object_path,row_count,sha256")
        .eq("ticker", ticker).eq("base_resolution", baseResolution).eq("range_start", rangeStart).eq("range_end", rangeEnd).eq("sha256", checksum).limit(1)
      if (lookupError) throw new Error(`Chart cold manifest lookup failed: ${lookupError.message}`)
      const existing = (existingRows || [])[0] as ManifestRow | undefined
      if (existing?.id && existing.object_path) {
        await verifyStoredObject(supabase, { objectPath: String(existing.object_path), checksum, rowCount: sorted.length })
        const { error: refreshError } = await supabase.from("chart_ohlcv_cold_manifests").update({
          verified_at: new Date().toISOString(),
          format_version: ARCHIVE_FORMAT_VERSION,
          byte_count: bytes.byteLength,
          provenance,
        }).eq("id", String(existing.id))
        if (refreshError) throw new Error(`Chart cold manifest refresh failed: ${refreshError.message}`)
        return { manifestId: String(existing.id), objectPath: String(existing.object_path), sha256: checksum, rowCount: sorted.length, byteCount: bytes.byteLength, reused: true }
      }

      let reused = false
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, { upsert: false, contentType: "application/gzip", cacheControl: "31536000" })
      if (uploadError) {
        try {
          await verifyStoredObject(supabase, { objectPath, checksum, rowCount: sorted.length })
          reused = true
        } catch {
          throw new Error(`Chart cold object upload failed: ${uploadError.message}`)
        }
      } else {
        await verifyStoredObject(supabase, { objectPath, checksum, rowCount: sorted.length })
      }

      const { data: manifest, error: manifestError } = await supabase.from("chart_ohlcv_cold_manifests").upsert({
        ticker,
        base_resolution: baseResolution,
        range_start: rangeStart,
        range_end: rangeEnd,
        object_path: objectPath,
        archive_format: "ndjson.gz",
        format_version: ARCHIVE_FORMAT_VERSION,
        byte_count: bytes.byteLength,
        row_count: sorted.length,
        sha256: checksum,
        provenance_batch_id: provenanceBatchId,
        provenance,
        verified_at: new Date().toISOString(),
      }, { onConflict: "ticker,base_resolution,range_start,range_end,sha256" }).select("id").single()
      if (manifestError || !manifest?.id) throw new Error(`Chart cold manifest upsert failed: ${manifestError?.message ?? "missing manifest id"}`)
      return { manifestId: String(manifest.id), objectPath, sha256: checksum, rowCount: sorted.length, byteCount: bytes.byteLength, reused }
    },
  }
}

export function createSupabaseColdOhlcvStorage(supabase: SupabaseClient): ColdOhlcvStorage {
  return createResolutionColdOhlcvStorage(supabase, "1m")
}

export function createSupabaseDailyColdOhlcvStorage(supabase: SupabaseClient): ColdOhlcvStorage {
  return createResolutionColdOhlcvStorage(supabase, "1D")
}
