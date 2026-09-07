import type { SupabaseClient } from "@supabase/supabase-js"

import {
  hasVietnamSecuritiesTradingCalendarCoverage,
  isVietnamSecuritiesTradingDateKey,
  vietnamDateKey,
} from "../calendar.ts"
import type { OhlcvBar } from "../../shared/technical/indicators.ts"
import { readCanonicalRawDaily } from "./raw-daily-store.ts"

const TICKER = /^[A-Z0-9]{2,12}$/
const LINEAGE_HASH = /^[a-f0-9]{64}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type AdjustedDailyRangeRead = {
  bars: OhlcvBar[]
  factorRunId: string | null
  factorVersion: string | null
  lineageHash: string | null
  complete: boolean
  unresolvedSessions: string[]
}

type RolloutRow = {
  ticker: string
  status: string
  factor_run_id: string | null
  factor_version: string | null
  event_lineage_hash: string | null
  verified_from: string | null
  verified_through: string | null
}

type AdjustedRow = {
  ticker: string
  session_date: string
  bar_time: string
  open: number | string
  high: number | string
  low: number | string
  close: number | string
  volume: number | string
  factor_run_id: string
  factor_version: string
  event_lineage_hash: string
  adjustment_engine_version: string
}

function utcDateKey(valueMs: number) {
  const date = new Date(valueMs)
  if (!Number.isFinite(date.getTime())) throw new Error("Adjusted Daily read range date is invalid")
  return date.toISOString().slice(0, 10)
}

function addCalendarDay(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

function requestedTradingRange(fromMs: number, toMs: number) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
    throw new Error("Adjusted Daily read range is invalid")
  }

  const from = utcDateKey(fromMs)
  const to = utcDateKey(toMs)
  if (
    !hasVietnamSecuritiesTradingCalendarCoverage(from)
    || !hasVietnamSecuritiesTradingCalendarCoverage(to)
  ) {
    throw new Error("Adjusted Daily read range is outside authoritative trading-calendar coverage")
  }

  const exchangeSessions: string[] = []
  for (let dateKey = from; dateKey <= to; dateKey = addCalendarDay(dateKey)) {
    if (!hasVietnamSecuritiesTradingCalendarCoverage(dateKey)) {
      throw new Error("Adjusted Daily read range crosses unsupported trading-calendar coverage")
    }
    if (isVietnamSecuritiesTradingDateKey(dateKey)) exchangeSessions.push(dateKey)
  }
  return { from, to, exchangeSessions }
}

function invalidResult(
  unresolvedSessions: string[],
  identity: { factorRunId?: string | null; factorVersion?: string | null; lineageHash?: string | null } = {},
): AdjustedDailyRangeRead {
  return {
    bars: [],
    factorRunId: identity.factorRunId ?? null,
    factorVersion: identity.factorVersion ?? null,
    lineageHash: identity.lineageHash ?? null,
    complete: false,
    unresolvedSessions: [...new Set(unresolvedSessions)].sort(),
  }
}

function validRollout(row: RolloutRow, ticker: string) {
  return row.ticker === ticker
    && (row.status === "shadow" || row.status === "active")
    && typeof row.factor_run_id === "string"
    && row.factor_run_id.length > 0
    && typeof row.factor_version === "string"
    && row.factor_version.trim().length > 0
    && typeof row.event_lineage_hash === "string"
    && LINEAGE_HASH.test(row.event_lineage_hash)
    && typeof row.verified_from === "string"
    && ISO_DATE.test(row.verified_from)
    && typeof row.verified_through === "string"
    && ISO_DATE.test(row.verified_through)
    && row.verified_from <= row.verified_through
}

function numericOhlcv(row: AdjustedRow) {
  const open = Number(row.open)
  const high = Number(row.high)
  const low = Number(row.low)
  const close = Number(row.close)
  const volume = Number(row.volume)
  const valid = Number.isFinite(open)
    && Number.isFinite(high)
    && Number.isFinite(low)
    && Number.isFinite(close)
    && Number.isFinite(volume)
    && open > 0
    && high > 0
    && low > 0
    && close > 0
    && volume >= 0
    && high >= Math.max(open, close, low)
    && low <= Math.min(open, close, high)
  return valid ? { open, high, low, close, volume } : null
}

function rowMatchesRollout(row: AdjustedRow, rollout: RolloutRow, ticker: string) {
  if (
    row.ticker !== ticker
    || row.factor_run_id !== rollout.factor_run_id
    || row.factor_version !== rollout.factor_version
    || row.event_lineage_hash !== rollout.event_lineage_hash
    || !row.adjustment_engine_version?.trim()
    || !ISO_DATE.test(row.session_date)
    || !isVietnamSecuritiesTradingDateKey(row.session_date)
  ) {
    return false
  }

  const barMs = Date.parse(row.bar_time)
  return Number.isFinite(barMs)
    && vietnamDateKey(barMs) === row.session_date
    && numericOhlcv(row) !== null
}

export async function loadAdjustedDailyRange(
  supabase: SupabaseClient,
  ticker: string,
  fromMs: number,
  toMs: number,
): Promise<AdjustedDailyRangeRead> {
  const normalizedTicker = ticker.trim().toUpperCase()
  if (!TICKER.test(normalizedTicker)) throw new Error("Adjusted Daily read ticker is invalid")

  const range = requestedTradingRange(fromMs, toMs)
  const unresolvedExchangeSessions = [...range.exchangeSessions]

  const { data: rolloutData, error: rolloutError } = await supabase
    .from("market_adjusted_daily_rollout")
    .select("ticker,status,factor_run_id,factor_version,event_lineage_hash,verified_from,verified_through")
    .eq("ticker", normalizedTicker)
    .maybeSingle()

  const rollout = rolloutData as RolloutRow | null
  if (rolloutError || !rollout || !validRollout(rollout, normalizedTicker)) {
    return invalidResult(unresolvedExchangeSessions)
  }

  const identity = {
    factorRunId: rollout.factor_run_id,
    factorVersion: rollout.factor_version,
    lineageHash: rollout.event_lineage_hash,
  }

  let rawSessions: string[]
  try {
    const canonicalRaw = await readCanonicalRawDaily(supabase, {
      ticker: normalizedTicker,
      from: range.from,
      to: range.to,
    })
    rawSessions = canonicalRaw.map((row) => row.sessionDate)
  } catch {
    return invalidResult(unresolvedExchangeSessions, identity)
  }

  const rawSessionSet = new Set(rawSessions)
  if (
    rawSessionSet.size !== rawSessions.length
    || rawSessions.some((sessionDate) => !isVietnamSecuritiesTradingDateKey(sessionDate))
  ) {
    return invalidResult(rawSessions.length > 0 ? rawSessions : unresolvedExchangeSessions, identity)
  }

  if (rawSessions.length === 0) {
    if (range.exchangeSessions.length === 0) {
      return {
        bars: [],
        factorRunId: rollout.factor_run_id,
        factorVersion: rollout.factor_version,
        lineageHash: rollout.event_lineage_hash,
        complete: true,
        unresolvedSessions: [],
      }
    }
    return invalidResult(unresolvedExchangeSessions, identity)
  }

  const firstExpected = rawSessions[0]
  const lastExpected = rawSessions[rawSessions.length - 1]
  if (rollout.verified_from! > firstExpected || rollout.verified_through! < lastExpected) {
    return invalidResult(rawSessions, identity)
  }

  const { data: adjustedData, error: adjustedError } = await supabase
    .from("market_ohlcv_adjusted_daily")
    .select("ticker,session_date,bar_time,open,high,low,close,volume,factor_run_id,factor_version,event_lineage_hash,adjustment_engine_version")
    .eq("ticker", normalizedTicker)
    .gte("session_date", range.from)
    .lte("session_date", range.to)
    .order("session_date", { ascending: true })

  if (adjustedError || !Array.isArray(adjustedData)) {
    return invalidResult(rawSessions, identity)
  }

  const rows = adjustedData as AdjustedRow[]
  const counts = new Map<string, number>()
  const invalidSessions = new Set<string>()
  let previousSession: string | null = null

  for (const row of rows) {
    counts.set(row.session_date, (counts.get(row.session_date) ?? 0) + 1)
    if (previousSession !== null && row.session_date <= previousSession) {
      invalidSessions.add(row.session_date)
    }
    previousSession = row.session_date

    if (!rawSessionSet.has(row.session_date) || !rowMatchesRollout(row, rollout, normalizedTicker)) {
      invalidSessions.add(row.session_date)
    }
  }

  for (const session of rawSessions) {
    if ((counts.get(session) ?? 0) !== 1) invalidSessions.add(session)
  }

  if (invalidSessions.size > 0 || rows.length !== rawSessions.length) {
    return invalidResult([...invalidSessions], identity)
  }

  const bars: OhlcvBar[] = []
  for (const row of rows) {
    const ohlcv = numericOhlcv(row)
    if (!ohlcv) return invalidResult([row.session_date], identity)
    const time = Math.floor(Date.parse(row.bar_time) / 1000)
    if (!Number.isInteger(time) || time <= 0) return invalidResult([row.session_date], identity)
    bars.push({ time, ...ohlcv })
  }

  return {
    bars,
    factorRunId: rollout.factor_run_id,
    factorVersion: rollout.factor_version,
    lineageHash: rollout.event_lineage_hash,
    complete: true,
    unresolvedSessions: [],
  }
}
