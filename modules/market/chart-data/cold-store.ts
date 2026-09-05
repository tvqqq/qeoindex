import "server-only"

import { createHash } from "node:crypto"
import { gzipSync, gunzipSync } from "node:zlib"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { CanonicalOhlcvBar } from "./contract"

const BUCKET = "chart-ohlcv"

type ManifestRow = {
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
  objectPath: string
  sha256: string
  rowCount: number
}

export interface ColdOhlcvStorage {
  readIntersectingRange(input: { ticker: string; from: number; to: number }): Promise<ColdReadResult>
  archiveVerifiedPartition(input: {
    ticker: string
    bars: CanonicalOhlcvBar[]
    provenanceBatchId?: string | null
  }): Promise<ColdArchiveResult>
}

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function serializeBars(bars: CanonicalOhlcvBar[]) {
  const text = bars
    .slice()
    .sort((a, b) => a.time - b.time)
    .map((bar) => JSON.stringify({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    }))
    .join("\n") + "\n"
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 })
}

function deserializeBars(bytes: Uint8Array): CanonicalOhlcvBar[] {
  const text = gunzipSync(bytes).toString("utf8")
  return text.split("\n").filter(Boolean).map((line) => {
    const raw = JSON.parse(line) as Record<string, unknown>
    return {
      time: Number(raw.time),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume),
    }
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

export function createSupabaseColdOhlcvStorage(supabase: SupabaseClient): ColdOhlcvStorage {
  return {
    async readIntersectingRange({ ticker, from, to }) {
      const fromIso = new Date(from * 1000).toISOString()
      const toIso = new Date(to * 1000).toISOString()
      const { data, error } = await supabase
        .from("chart_ohlcv_cold_manifests")
        .select("object_path,range_start,range_end,row_count,sha256,archive_format")
        .eq("ticker", ticker)
        .eq("base_resolution", "1m")
        .lte("range_start", toIso)
        .gte("range_end", fromIso)
        .order("range_start", { ascending: true })
      if (error) throw new Error(`Chart cold manifest read failed: ${error.message}`)

      const bars: CanonicalOhlcvBar[] = []
      let manifestsRead = 0
      for (const raw of (data || []) as ManifestRow[]) {
        const objectPath = String(raw.object_path || "")
        const expectedHash = String(raw.sha256 || "")
        const expectedRows = Number(raw.row_count)
        if (!objectPath || raw.archive_format !== "ndjson.gz") continue
        const { data: object, error: downloadError } = await supabase.storage.from(BUCKET).download(objectPath)
        if (downloadError || !object) throw new Error(`Chart cold object read failed: ${downloadError?.message ?? "missing object"}`)
        const bytes = await blobBytes(object)
        if (hash(bytes) !== expectedHash) throw new Error("Chart cold object checksum mismatch")
        const decoded = deserializeBars(bytes)
        if (decoded.length !== expectedRows) throw new Error("Chart cold object row-count mismatch")
        bars.push(...decoded.filter((bar) => bar.time >= from && bar.time <= to))
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
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, bytes, {
        upsert: false,
        contentType: "application/gzip",
        cacheControl: "31536000",
      })
      if (uploadError) throw new Error(`Chart cold object upload failed: ${uploadError.message}`)

      const { data: verificationObject, error: verificationError } = await supabase.storage.from(BUCKET).download(objectPath)
      if (verificationError || !verificationObject) throw new Error(`Chart cold verification read failed: ${verificationError?.message ?? "missing object"}`)
      const verificationBytes = await blobBytes(verificationObject)
      if (hash(verificationBytes) !== checksum) throw new Error("Chart cold verification checksum mismatch")
      if (deserializeBars(verificationBytes).length !== sorted.length) throw new Error("Chart cold verification row-count mismatch")

      const { error: manifestError } = await supabase.from("chart_ohlcv_cold_manifests").insert({
        ticker,
        base_resolution: "1m",
        range_start: new Date(sorted[0].time * 1000).toISOString(),
        range_end: new Date(sorted.at(-1)!.time * 1000).toISOString(),
        object_path: objectPath,
        archive_format: "ndjson.gz",
        row_count: sorted.length,
        sha256: checksum,
        provenance_batch_id: provenanceBatchId,
        verified_at: new Date().toISOString(),
      })
      if (manifestError) throw new Error(`Chart cold manifest insert failed: ${manifestError.message}`)
      return { objectPath, sha256: checksum, rowCount: sorted.length }
    },
  }
}
