import type { SupabaseClient } from "@supabase/supabase-js"

import { persistDailyOhlcvRows } from "./daily-provenance"

export type DailyProvenanceCanaryResult = {
  passed: boolean
  ticker: string
  barTime: string
  provenanceId: number
  bridgeLegacyColumnsPresent: boolean
  bridgeLegacyColumnsNull: boolean | null
  logicalProvenancePreserved: boolean
}

type CanaryLogicalRow = {
  ticker?: unknown
  timeframe?: unknown
  bar_time?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
  provider?: unknown
  provider_detail?: unknown
  source_url?: unknown
  fetched_at?: unknown
  provenance_id?: unknown
  provenance_consistent?: unknown
}

function missingLegacyColumns(message: string) {
  return /(?:provider_detail|source_url)/i.test(message)
    && /(?:does not exist|not found|schema cache|could not find)/i.test(message)
}

function requiredString(value: unknown, field: string) {
  const result = String(value ?? "")
  if (!result) throw new Error(`Daily provenance canary missing ${field}`)
  return result
}

function finiteNumber(value: unknown, field: string) {
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`Daily provenance canary invalid ${field}`)
  return result
}

function sameNumber(left: unknown, right: number) {
  return Number(left) === right
}

export async function runDailyProvenanceCanary(
  supabase: SupabaseClient,
  ticker: string,
): Promise<DailyProvenanceCanaryResult> {
  const normalizedTicker = String(ticker || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(normalizedTicker)) throw new Error(`Invalid Daily provenance canary ticker: ${ticker}`)

  const logicalRead = await supabase
    .from("market_ohlcv_history_compat")
    .select("ticker,timeframe,bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at,provenance_id,provenance_consistent")
    .eq("ticker", normalizedTicker)
    .eq("timeframe", "1D")
    .eq("provenance_consistent", true)
    .order("bar_time", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (logicalRead.error) throw new Error(`Daily provenance canary source read failed: ${logicalRead.error.message}`)
  if (!logicalRead.data) throw new Error(`Daily provenance canary found no canonical row for ${normalizedTicker}`)

  const source = logicalRead.data as CanaryLogicalRow
  const row = {
    ticker: requiredString(source.ticker, "ticker"),
    timeframe: "1D" as const,
    bar_time: requiredString(source.bar_time, "bar_time"),
    open: finiteNumber(source.open, "open"),
    high: finiteNumber(source.high, "high"),
    low: finiteNumber(source.low, "low"),
    close: finiteNumber(source.close, "close"),
    volume: finiteNumber(source.volume, "volume"),
    provider: requiredString(source.provider, "provider"),
    provider_detail: requiredString(source.provider_detail, "provider_detail"),
    source_url: requiredString(source.source_url, "source_url"),
    fetched_at: requiredString(source.fetched_at, "fetched_at"),
  }

  const legacyNulling = await supabase
    .from("market_ohlcv_history")
    .update({ provider_detail: null, source_url: null })
    .eq("ticker", row.ticker)
    .eq("timeframe", "1D")
    .eq("bar_time", row.bar_time)
    .select("ticker")

  let bridgeLegacyColumnsPresent = true
  if (legacyNulling.error) {
    if (!missingLegacyColumns(legacyNulling.error.message)) {
      throw new Error(`Daily provenance canary bridge nulling failed: ${legacyNulling.error.message}`)
    }
    bridgeLegacyColumnsPresent = false
  } else if ((legacyNulling.data || []).length !== 1) {
    throw new Error(`Daily provenance canary bridge nulling did not target exactly one row for ${row.ticker}`)
  }

  await persistDailyOhlcvRows(supabase, [row])

  const compactRead = await supabase
    .from("market_ohlcv_history")
    .select("ticker,timeframe,bar_time,open,high,low,close,volume,provider,fetched_at,provenance_id")
    .eq("ticker", row.ticker)
    .eq("timeframe", "1D")
    .eq("bar_time", row.bar_time)
    .maybeSingle()
  if (compactRead.error) throw new Error(`Daily provenance canary compact read failed: ${compactRead.error.message}`)
  if (!compactRead.data) throw new Error(`Daily provenance canary compact row disappeared for ${row.ticker}`)

  const afterLogical = await supabase
    .from("market_ohlcv_history_compat")
    .select("ticker,timeframe,bar_time,open,high,low,close,volume,provider,provider_detail,source_url,fetched_at,provenance_id,provenance_consistent")
    .eq("ticker", row.ticker)
    .eq("timeframe", "1D")
    .eq("bar_time", row.bar_time)
    .maybeSingle()
  if (afterLogical.error) throw new Error(`Daily provenance canary logical readback failed: ${afterLogical.error.message}`)
  if (!afterLogical.data) throw new Error(`Daily provenance canary logical row disappeared for ${row.ticker}`)

  const compact = compactRead.data as CanaryLogicalRow
  const logical = afterLogical.data as CanaryLogicalRow
  const provenanceId = Number(compact.provenance_id)
  const factPreserved = String(compact.ticker) === row.ticker
    && String(compact.timeframe) === "1D"
    && String(compact.bar_time) === row.bar_time
    && sameNumber(compact.open, row.open)
    && sameNumber(compact.high, row.high)
    && sameNumber(compact.low, row.low)
    && sameNumber(compact.close, row.close)
    && sameNumber(compact.volume, row.volume)
    && String(compact.provider) === row.provider
    && String(compact.fetched_at) === row.fetched_at
    && Number.isSafeInteger(provenanceId)
    && provenanceId > 0

  const logicalProvenancePreserved = logical.provenance_consistent === true
    && String(logical.provider) === row.provider
    && String(logical.provider_detail) === row.provider_detail
    && String(logical.source_url) === row.source_url
    && Number(logical.provenance_id) === provenanceId

  let bridgeLegacyColumnsNull: boolean | null = null
  if (bridgeLegacyColumnsPresent) {
    const legacyReadback = await supabase
      .from("market_ohlcv_history")
      .select("provider_detail,source_url")
      .eq("ticker", row.ticker)
      .eq("timeframe", "1D")
      .eq("bar_time", row.bar_time)
      .maybeSingle()
    if (legacyReadback.error) throw new Error(`Daily provenance canary legacy readback failed: ${legacyReadback.error.message}`)
    bridgeLegacyColumnsNull = Boolean(legacyReadback.data)
      && legacyReadback.data?.provider_detail == null
      && legacyReadback.data?.source_url == null
  }

  const passed = factPreserved
    && logicalProvenancePreserved
    && (!bridgeLegacyColumnsPresent || bridgeLegacyColumnsNull === true)

  return {
    passed,
    ticker: row.ticker,
    barTime: row.bar_time,
    provenanceId,
    bridgeLegacyColumnsPresent,
    bridgeLegacyColumnsNull,
    logicalProvenancePreserved,
  }
}
