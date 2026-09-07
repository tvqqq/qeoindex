import { createHash } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

export type CanonicalRawPriceBasis = "RAW"
export type CanonicalRawSourcePriceUnit = "VND_THOUSANDS"

export type RawDailyObservation = {
  ticker: string
  sessionDate: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  provider: string
  providerDetail: string
  sourceUrl: string
  sourcePriceUnit: CanonicalRawSourcePriceUnit
  normalizationVersion: string
  fetchedAt: string
}

export type RawDailyObservationPayload = {
  ticker: string
  session_date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  price_basis: CanonicalRawPriceBasis
  provider: string
  provider_detail: string
  source_url: string
  source_price_unit: CanonicalRawSourcePriceUnit
  normalization_version: string
  raw_evidence_hash: string
  fetched_at: string
}

export type RawDailyPersistenceResult = {
  evidenceId: string
  canonicalSelected: boolean
}

export type CanonicalRawDailyBar = {
  ticker: string
  sessionDate: string
  evidenceId: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  priceBasis: CanonicalRawPriceBasis
  provider: string
  providerDetail: string
  sourceUrl: string
  sourcePriceUnit: CanonicalRawSourcePriceUnit
  normalizationVersion: string
  rawEvidenceHash: string
}

export type CanonicalRawDailyReadInput = {
  ticker: string
  from?: string
  to?: string
}

type CanonicalRawDailyRow = {
  ticker: unknown
  session_date: unknown
  evidence_id: unknown
  open: unknown
  high: unknown
  low: unknown
  close: unknown
  volume: unknown
  price_basis: unknown
  provider: unknown
  provider_detail: unknown
  source_url: unknown
  source_price_unit: unknown
  normalization_version: unknown
  raw_evidence_hash: unknown
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid raw Daily ticker")
  return ticker
}

function normalizeSessionDate(value: string, field = "session date") {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error(`Invalid raw Daily ${field}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid raw Daily ${field}`)
  }
  return value
}

function normalizeNonEmpty(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Invalid raw Daily ${field}`)
  return normalized
}

function normalizeFetchedAt(value: string) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error("Invalid raw Daily fetchedAt")
  return new Date(parsed).toISOString()
}

function validateOhlcv(input: Pick<RawDailyObservation, "open" | "high" | "low" | "close" | "volume">) {
  const values = [input.open, input.high, input.low, input.close, input.volume]
  if (!values.every(Number.isFinite)) throw new Error("Invalid raw Daily OHLCV")
  if (input.open <= 0 || input.high <= 0 || input.low <= 0 || input.close <= 0 || input.volume < 0) {
    throw new Error("Invalid raw Daily OHLCV")
  }
  if (input.high < Math.max(input.open, input.close, input.low) || input.low > Math.min(input.open, input.close, input.high)) {
    throw new Error("Invalid raw Daily OHLCV")
  }
}

function evidenceIdentity(input: Omit<RawDailyObservationPayload, "raw_evidence_hash" | "fetched_at">) {
  // fetched_at is deliberately excluded: repeated acquisition of the exact same
  // provider observation must resolve to the same immutable evidence identity.
  return JSON.stringify([
    input.ticker,
    input.session_date,
    input.open,
    input.high,
    input.low,
    input.close,
    input.volume,
    input.price_basis,
    input.provider,
    input.provider_detail,
    input.source_url,
    input.source_price_unit,
    input.normalization_version,
  ])
}

export function buildRawDailyObservationPayload(observation: RawDailyObservation): RawDailyObservationPayload {
  const ticker = normalizeTicker(observation.ticker)
  const sessionDate = normalizeSessionDate(observation.sessionDate)
  validateOhlcv(observation)
  if (observation.sourcePriceUnit !== "VND_THOUSANDS") throw new Error("Invalid raw Daily sourcePriceUnit")

  const identity = {
    ticker,
    session_date: sessionDate,
    open: observation.open,
    high: observation.high,
    low: observation.low,
    close: observation.close,
    volume: observation.volume,
    price_basis: "RAW" as const,
    provider: normalizeNonEmpty(observation.provider, "provider"),
    provider_detail: normalizeNonEmpty(observation.providerDetail, "providerDetail"),
    source_url: normalizeNonEmpty(observation.sourceUrl, "sourceUrl"),
    source_price_unit: observation.sourcePriceUnit,
    normalization_version: normalizeNonEmpty(observation.normalizationVersion, "normalizationVersion"),
  }

  return {
    ...identity,
    raw_evidence_hash: createHash("sha256").update(evidenceIdentity(identity)).digest("hex"),
    fetched_at: normalizeFetchedAt(observation.fetchedAt),
  }
}

function parsePersistenceResult(data: unknown): RawDailyPersistenceResult {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== "object") throw new Error("Raw Daily persistence returned an invalid result")
  const record = row as Record<string, unknown>
  const evidenceId = typeof record.evidence_id === "string" ? record.evidence_id : ""
  const canonicalSelected = record.canonical_selected
  if (!evidenceId || typeof canonicalSelected !== "boolean") {
    throw new Error("Raw Daily persistence returned an invalid result")
  }
  return { evidenceId, canonicalSelected }
}

function numericEqual(actual: unknown, expected: number) {
  return typeof actual === "number" || typeof actual === "string"
    ? Number(actual) === expected
    : false
}

function canonicalRowMatches(
  row: CanonicalRawDailyRow,
  payload: RawDailyObservationPayload,
  evidenceId: string,
) {
  return row.ticker === payload.ticker
    && row.session_date === payload.session_date
    && row.evidence_id === evidenceId
    && numericEqual(row.open, payload.open)
    && numericEqual(row.high, payload.high)
    && numericEqual(row.low, payload.low)
    && numericEqual(row.close, payload.close)
    && numericEqual(row.volume, payload.volume)
    && row.price_basis === "RAW"
    && row.provider === payload.provider
    && row.provider_detail === payload.provider_detail
    && row.source_url === payload.source_url
    && row.source_price_unit === payload.source_price_unit
    && row.normalization_version === payload.normalization_version
    && row.raw_evidence_hash === payload.raw_evidence_hash
}

export async function persistRawDailyObservation(
  supabase: SupabaseClient,
  observation: RawDailyObservation,
  options: { selectCanonical?: boolean } = {},
): Promise<RawDailyPersistenceResult> {
  const payload = buildRawDailyObservationPayload(observation)
  const selectCanonical = options.selectCanonical === true

  const { data, error } = await supabase.rpc("qeo_persist_raw_daily_observation", {
    p_observation: payload,
    p_select_canonical: selectCanonical,
  })
  if (error) throw new Error("Raw Daily persistence failed")

  const result = parsePersistenceResult(data)
  if (result.canonicalSelected !== selectCanonical) {
    throw new Error("Raw Daily persistence selection mismatch")
  }
  if (!selectCanonical) return result

  const { data: row, error: readError } = await supabase
    .from("market_ohlcv_raw_daily")
    .select("ticker,session_date,evidence_id,open,high,low,close,volume,price_basis,provider,provider_detail,source_url,source_price_unit,normalization_version,raw_evidence_hash")
    .eq("ticker", payload.ticker)
    .eq("session_date", payload.session_date)
    .maybeSingle()

  if (readError || !row || !canonicalRowMatches(row as CanonicalRawDailyRow, payload, result.evidenceId)) {
    throw new Error("Canonical raw Daily read-back mismatch")
  }

  return result
}

function parseCanonicalRow(row: CanonicalRawDailyRow): CanonicalRawDailyBar {
  if (
    typeof row.ticker !== "string"
    || typeof row.session_date !== "string"
    || typeof row.evidence_id !== "string"
    || typeof row.provider !== "string"
    || typeof row.provider_detail !== "string"
    || typeof row.source_url !== "string"
    || row.source_price_unit !== "VND_THOUSANDS"
    || typeof row.normalization_version !== "string"
    || typeof row.raw_evidence_hash !== "string"
    || !/^[a-f0-9]{64}$/.test(row.raw_evidence_hash)
    || row.price_basis !== "RAW"
  ) {
    throw new Error("Canonical raw Daily row is invalid")
  }

  const open = Number(row.open)
  const high = Number(row.high)
  const low = Number(row.low)
  const close = Number(row.close)
  const volume = Number(row.volume)
  validateOhlcv({ open, high, low, close, volume })
  normalizeTicker(row.ticker)
  normalizeSessionDate(row.session_date)

  return {
    ticker: row.ticker,
    sessionDate: row.session_date,
    evidenceId: row.evidence_id,
    open,
    high,
    low,
    close,
    volume,
    priceBasis: "RAW",
    provider: row.provider,
    providerDetail: row.provider_detail,
    sourceUrl: row.source_url,
    sourcePriceUnit: "VND_THOUSANDS",
    normalizationVersion: row.normalization_version,
    rawEvidenceHash: row.raw_evidence_hash,
  }
}

export async function readCanonicalRawDaily(
  supabase: SupabaseClient,
  input: CanonicalRawDailyReadInput,
): Promise<CanonicalRawDailyBar[]> {
  const ticker = normalizeTicker(input.ticker)
  if (input.from) normalizeSessionDate(input.from, "from date")
  if (input.to) normalizeSessionDate(input.to, "to date")
  if (input.from && input.to && input.from > input.to) throw new Error("Invalid raw Daily date range")

  let query = supabase
    .from("market_ohlcv_raw_daily")
    .select("ticker,session_date,evidence_id,open,high,low,close,volume,price_basis,provider,provider_detail,source_url,source_price_unit,normalization_version,raw_evidence_hash")
    .eq("ticker", ticker)
  if (input.from) query = query.gte("session_date", input.from)
  if (input.to) query = query.lte("session_date", input.to)

  const { data, error } = await query.order("session_date", { ascending: true })
  if (error) throw new Error("Canonical raw Daily read failed")
  if (!Array.isArray(data)) throw new Error("Canonical raw Daily read failed")

  try {
    return data.map((row) => parseCanonicalRow(row as CanonicalRawDailyRow))
  } catch {
    throw new Error("Canonical raw Daily read failed")
  }
}
