import "server-only"

import { createHash } from "node:crypto"
import { gzipSync, gunzipSync } from "node:zlib"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"

const BUCKET = "chart-ohlcv"
const ARCHIVE_FORMAT_VERSION = 1

type ManifestRow = {
  id?: unknown
  object_path?: unknown
  range_start?: unknown
  range_end?: unknown
  row_count?: unknown
  sha256?: unknown
  archive_format?: unknown
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
  archiveVerifiedPartition(input: { ticker: string; bars: CanonicalOhlcvBar[]; provenanceBatchId?: string | null }): Promise<ColdArchiveResult>
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

function archivePath(ticker: string, bars: CanonicalOhlcvBar[], checksum: string) {
  const first = bars[0]
  const last = bars.at(-1)!
  const date = new Date(first.time * 1000)
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric" }).format(date)
  const month = new Intl.DateTimeFormat("en", { timeZone: "Asia/Ho_Chi_Minh", month: "2-digit" }).format(date)
  return `1m/ticker=${ticker}/year=${year}/month=${month}/${first.time}-${last.time}-${checksum}.ndjson.gz`
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

export function createSupabaseColdOhlcvStorage(supabase: SupabaseClient): ColdOhlcvStorage {
  return {
    async readIntersectingRange({ ticker, from, to }) {
      const { data, error } = await supabase.from("chart_ohlcv_cold_manifests")
        .select("object_path,range_start,range_end,row_count,sha256,archive_format")
        .eq("ticker", ticker).eq("base_resolution", "1m")
        .lte("range_start", new Date(to * 1000).toISOString()).gte("range_end", new Date(from * 1000).toISOString())
        .order("range_start", { ascending: true })
      if (error) throw new Error(`Chart cold manifest read failed: ${error.message}`)
      const bars: CanonicalOhlcvBar[] = []
      let manifestsRead = 0
      for (const raw of (data || []) as ManifestRow[]) {
        const objectPath = String(raw.object_path || "")
        const expectedHash = String(raw.sha256 || "")
        const expectedRows = Number(raw.row_count)
        if (!objectPath || raw.archive_format !== "ndjson.gz") continue
        const bytes = await verifyStoredObject(supabase, { objectPath, checksum: expectedHash, rowCount: expectedRows })
        bars.push(...deserializeBars(bytes).filter((bar) => bar.time >= from && bar.time <= to))
        manifestsRead += 1
      }
      return { bars, manifestsRead }
    },

    async archiveVerifiedPartition({ ticker, bars, provenanceBatchId = null }) {
      if (!bars.length) throw new Error("Cannot archive an empty chart partition")
      const sorted = [...bars].sort((a, b) => a.time - b.time)
      const bytes = serializeBars(sorted)
      const checksum = hash(bytes)
      const objectPath = archivePath(ticker, sorted, checksum)
      const rangeStart = new Date(sorted[0].time * 1000).toISOString()
      const rangeEnd = new Date(sorted.at(-1)!.time * 1000).toISOString()

      const { data: existingRows, error: lookupError } = await supabase.from("chart_ohlcv_cold_manifests")
        .select("id,object_path,row_count,sha256")
        .eq("ticker", ticker).eq("base_resolution", "1m").eq("range_start", rangeStart).eq("range_end", rangeEnd).eq("sha256", checksum).limit(1)
      if (lookupError) throw new Error(`Chart cold manifest lookup failed: ${lookupError.message}`)
      const existing = (existingRows || [])[0] as ManifestRow | undefined
      if (existing?.id && existing.object_path) {
        await verifyStoredObject(supabase, { objectPath: String(existing.object_path), checksum, rowCount: sorted.length })
        const { error: refreshError } = await supabase.from("chart_ohlcv_cold_manifests").update({ verified_at: new Date().toISOString(), format_version: ARCHIVE_FORMAT_VERSION, byte_count: bytes.byteLength }).eq("id", String(existing.id))
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
        ticker, base_resolution: "1m", range_start: rangeStart, range_end: rangeEnd, object_path: objectPath,
        archive_format: "ndjson.gz", format_version: ARCHIVE_FORMAT_VERSION, byte_count: bytes.byteLength,
        row_count: sorted.length, sha256: checksum, provenance_batch_id: provenanceBatchId, verified_at: new Date().toISOString(),
      }, { onConflict: "ticker,base_resolution,range_start,range_end,sha256" }).select("id").single()
      if (manifestError || !manifest?.id) throw new Error(`Chart cold manifest upsert failed: ${manifestError?.message ?? "missing manifest id"}`)
      return { manifestId: String(manifest.id), objectPath, sha256: checksum, rowCount: sorted.length, byteCount: bytes.byteLength, reused }
    },
  }
}
