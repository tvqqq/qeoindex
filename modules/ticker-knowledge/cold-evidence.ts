import "server-only"

import { createHash } from "node:crypto"
import { gzipSync, gunzipSync } from "node:zlib"
import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeTicker } from "./domain.ts"

export const COLD_EVIDENCE_FORMAT_VERSION = 1 as const
export const COLD_EVIDENCE_ARCHIVE_FORMAT = "json.gz" as const

export type ColdEvidenceDomain = "AI_COUNCIL" | "RESEARCH_REPORT" | "TICKER_THESIS" | "OTHER"

export interface ColdEvidencePointer {
  bucket: string
  objectPath: string
  sha256: string
  contentSha256: string
  byteCount: number
  archiveFormat: typeof COLD_EVIDENCE_ARCHIVE_FORMAT
  formatVersion: typeof COLD_EVIDENCE_FORMAT_VERSION
  domain: ColdEvidenceDomain
  ticker: string
  sourceId: string
  sourceVersion: string
  asOf: string
}

export interface ArchiveColdEvidenceInput<T = unknown> {
  domain: ColdEvidenceDomain
  ticker: string
  sourceId: string
  sourceVersion: string
  asOf: string
  payload: T
}

export interface ColdEvidenceEnvelope<T = unknown> {
  formatVersion: typeof COLD_EVIDENCE_FORMAT_VERSION
  domain: ColdEvidenceDomain
  ticker: string
  sourceId: string
  sourceVersion: string
  asOf: string
  payload: T
}

export interface ColdEvidenceStore {
  archiveJson<T>(input: ArchiveColdEvidenceInput<T>): Promise<{ pointer: ColdEvidencePointer; reused: boolean }>
  restoreJson<T = unknown>(pointer: ColdEvidencePointer): Promise<ColdEvidenceEnvelope<T>>
}

function hash(bytes: Uint8Array | string) {
  return createHash("sha256").update(bytes).digest("hex")
}

function sanitizePathSegment(value: string, label: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  if (!normalized) throw new Error(`${label} is required`)
  return normalized.slice(0, 160)
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cold evidence cannot contain non-finite numbers")
    return value
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      const child = record[key]
      if (child === undefined) continue
      if (["function", "symbol", "bigint"].includes(typeof child)) throw new Error("Cold evidence payload must be JSON serializable")
      result[key] = canonicalize(child)
    }
    return result
  }
  throw new Error("Cold evidence payload must be JSON serializable")
}

function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value))
}

function validAsOf(value: string) {
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) throw new Error("Cold evidence asOf must be an ISO timestamp")
  return new Date(timestamp).toISOString()
}

function objectPath(input: ColdEvidenceEnvelope, contentHash: string) {
  const date = new Date(input.asOf)
  const year = date.toISOString().slice(0, 4)
  const month = date.toISOString().slice(5, 7)
  return [
    `v${COLD_EVIDENCE_FORMAT_VERSION}`,
    `domain=${sanitizePathSegment(input.domain.toLowerCase(), "domain")}`,
    `ticker=${sanitizePathSegment(input.ticker, "ticker")}`,
    `year=${year}`,
    `month=${month}`,
    `source=${sanitizePathSegment(input.sourceId, "sourceId")}`,
    `version=${sanitizePathSegment(input.sourceVersion, "sourceVersion")}`,
    `${contentHash}.${COLD_EVIDENCE_ARCHIVE_FORMAT}`,
  ].join("/")
}

async function blobBytes(blob: Blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

function parseEnvelope<T>(bytes: Uint8Array): { envelope: ColdEvidenceEnvelope<T>; canonicalText: string } {
  const raw = gunzipSync(bytes).toString("utf8")
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Cold evidence archive envelope is invalid")
  const envelope = parsed as ColdEvidenceEnvelope<T>
  if (envelope.formatVersion !== COLD_EVIDENCE_FORMAT_VERSION || !envelope.sourceId || !envelope.sourceVersion || !envelope.asOf) {
    throw new Error("Cold evidence archive version/identity is invalid")
  }
  envelope.ticker = normalizeTicker(envelope.ticker)
  return { envelope, canonicalText: canonicalJson(envelope) }
}

export function createSupabaseColdEvidenceStore(
  supabase: SupabaseClient,
  options: { bucket?: string } = {},
): ColdEvidenceStore {
  const bucket = options.bucket?.trim() || "ticker-knowledge-cold"
  if (!bucket) throw new Error("Cold evidence bucket is required")

  async function download(path: string) {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error || !data) throw new Error(`Cold evidence download failed: ${error?.message ?? "missing object"}`)
    return blobBytes(data)
  }

  async function verifyExisting<T>(path: string, expectedContentHash: string, expectedSha?: string) {
    const bytes = await download(path)
    const actualSha = hash(bytes)
    if (expectedSha && actualSha !== expectedSha) throw new Error("Cold evidence checksum mismatch")
    const { envelope, canonicalText } = parseEnvelope<T>(bytes)
    if (hash(canonicalText) !== expectedContentHash) throw new Error("Cold evidence content checksum mismatch")
    return { bytes, envelope, sha256: actualSha }
  }

  return {
    async archiveJson<T>(input: ArchiveColdEvidenceInput<T>) {
      const envelope: ColdEvidenceEnvelope<T> = {
        formatVersion: COLD_EVIDENCE_FORMAT_VERSION,
        domain: input.domain,
        ticker: normalizeTicker(input.ticker),
        sourceId: input.sourceId.trim(),
        sourceVersion: input.sourceVersion.trim(),
        asOf: validAsOf(input.asOf),
        payload: input.payload,
      }
      if (!envelope.sourceId || !envelope.sourceVersion) throw new Error("Cold evidence source identity is required")
      const canonicalText = canonicalJson(envelope)
      const contentSha256 = hash(canonicalText)
      const compressed = gzipSync(Buffer.from(canonicalText, "utf8"), { level: 9 })
      const path = objectPath(envelope as ColdEvidenceEnvelope, contentSha256)

      let reused = false
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, compressed, {
        upsert: false,
        contentType: "application/gzip",
        cacheControl: "31536000",
      })
      if (uploadError) {
        await verifyExisting(path, contentSha256)
        reused = true
      }
      const verified = await verifyExisting<T>(path, contentSha256)
      const pointer: ColdEvidencePointer = {
        bucket,
        objectPath: path,
        sha256: verified.sha256,
        contentSha256,
        byteCount: verified.bytes.byteLength,
        archiveFormat: COLD_EVIDENCE_ARCHIVE_FORMAT,
        formatVersion: COLD_EVIDENCE_FORMAT_VERSION,
        domain: envelope.domain,
        ticker: envelope.ticker,
        sourceId: envelope.sourceId,
        sourceVersion: envelope.sourceVersion,
        asOf: envelope.asOf,
      }
      return { pointer, reused }
    },

    async restoreJson<T = unknown>(pointer: ColdEvidencePointer) {
      if (pointer.bucket !== bucket) throw new Error("Cold evidence pointer bucket mismatch")
      if (pointer.archiveFormat !== COLD_EVIDENCE_ARCHIVE_FORMAT || pointer.formatVersion !== COLD_EVIDENCE_FORMAT_VERSION) {
        throw new Error("Cold evidence pointer version is unsupported")
      }
      const verified = await verifyExisting<T>(pointer.objectPath, pointer.contentSha256, pointer.sha256)
      const envelope = verified.envelope
      if (
        envelope.domain !== pointer.domain
        || envelope.ticker !== normalizeTicker(pointer.ticker)
        || envelope.sourceId !== pointer.sourceId
        || envelope.sourceVersion !== pointer.sourceVersion
        || envelope.asOf !== pointer.asOf
      ) {
        throw new Error("Cold evidence pointer identity mismatch")
      }
      return envelope
    },
  }
}
