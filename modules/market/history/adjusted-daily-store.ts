import type { SupabaseClient } from "@supabase/supabase-js"

import { readCanonicalRawDaily, type CanonicalRawDailyBar } from "./raw-daily-store.ts"
import {
  applyDailyAdjustment,
  type RawDailyBar,
  type ShadowFactorRun,
  type ShadowFactorTransition,
} from "./adjusted-daily.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TICKER = /^[A-Z0-9]{2,12}$/
const LINEAGE_HASH = /^[a-f0-9]{64}$/

export type AdjustedDailyRebuildResult = {
  rebuiltSessions: number
  unresolvedSessions: string[]
  firstSession: string | null
  lastSession: string | null
  factorRunId: string
  factorVersion: string
  lineageHash: string
}

type FactorRunRow = {
  id: string
  ticker: string
  factor_version: string
  engine_version: string
  event_lineage_hash: string
  status: string
}

type FactorTransitionRow = {
  effective_session: string
  cumulative_price_factor: number | string
  cumulative_volume_factor: number | string
}

type ReadbackRow = {
  session_date: string
  bar_time: string
  open: number | string
  high: number | string
  low: number | string
  close: number | string
  volume: number | string
  raw_bar_time: string
  factor_run_id: string
  factor_version: string
  event_lineage_hash: string
  adjustment_engine_version: string
}

function validIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function canonicalDailyTimestamp(sessionDate: string) {
  return `${sessionDate}T02:00:00.000Z`
}

function sameInstant(left: string, right: string) {
  const leftMs = Date.parse(left)
  const rightMs = Date.parse(right)
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs
}

function sameNumber(actual: number | string, expected: number) {
  const numeric = Number(actual)
  return Number.isFinite(numeric) && numeric === expected
}

function toRun(row: FactorRunRow): ShadowFactorRun {
  return {
    id: row.id,
    ticker: row.ticker,
    factorVersion: row.factor_version,
    engineVersion: row.engine_version,
    eventLineageHash: row.event_lineage_hash,
    status: row.status as ShadowFactorRun["status"],
  }
}

function toTransition(row: FactorTransitionRow): ShadowFactorTransition {
  return {
    effectiveSession: row.effective_session,
    cumulativePriceFactor: Number(row.cumulative_price_factor),
    cumulativeVolumeFactor: Number(row.cumulative_volume_factor),
  }
}

function toRawDaily(row: CanonicalRawDailyBar): RawDailyBar {
  return {
    ticker: row.ticker,
    sessionDate: row.sessionDate,
    barTime: canonicalDailyTimestamp(row.sessionDate),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    sourcePriceBasis: row.priceBasis,
  }
}

function readbackMatches(
  row: ReadbackRow,
  expected: {
    sessionDate: string
    barTime: string
    open: number
    high: number
    low: number
    close: number
    volume: number
    rawBarTime: string
    factorRunId: string
    factorVersion: string
    lineageHash: string
    engineVersion: string
  },
) {
  return row.session_date === expected.sessionDate
    && sameInstant(row.bar_time, expected.barTime)
    && sameNumber(row.open, expected.open)
    && sameNumber(row.high, expected.high)
    && sameNumber(row.low, expected.low)
    && sameNumber(row.close, expected.close)
    && sameNumber(row.volume, expected.volume)
    && sameInstant(row.raw_bar_time, expected.rawBarTime)
    && row.factor_run_id === expected.factorRunId
    && row.factor_version === expected.factorVersion
    && row.event_lineage_hash === expected.lineageHash
    && row.adjustment_engine_version === expected.engineVersion
}

async function persistRollout(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const { error } = await supabase
    .from("market_adjusted_daily_rollout")
    .upsert(payload, { onConflict: "ticker" })
  if (error) throw new Error("Adjusted Daily rollout persistence failed")
}

export async function rebuildAdjustedDailyRange(input: {
  supabase: SupabaseClient
  ticker: string
  fromDate: string
  toDate: string
  expectedFactorRunId: string
  expectedLineageHash: string
}): Promise<AdjustedDailyRebuildResult> {
  if (
    !TICKER.test(input.ticker)
    || !validIsoDate(input.fromDate)
    || !validIsoDate(input.toDate)
    || input.fromDate > input.toDate
    || !input.expectedFactorRunId
    || !LINEAGE_HASH.test(input.expectedLineageHash)
  ) {
    throw new Error("Adjusted Daily rebuild input is invalid")
  }

  const { data: runData, error: runError } = await input.supabase
    .from("market_adjustment_factor_runs")
    .select("id,ticker,factor_version,engine_version,event_lineage_hash,status")
    .eq("id", input.expectedFactorRunId)
    .eq("ticker", input.ticker)
    .maybeSingle()

  const runRow = runData as FactorRunRow | null
  if (
    runError
    || !runRow
    || runRow.id !== input.expectedFactorRunId
    || runRow.ticker !== input.ticker
    || (runRow.status !== "candidate" && runRow.status !== "active")
  ) {
    throw new Error("Adjusted Daily factor run is not consumable")
  }
  if (runRow.event_lineage_hash !== input.expectedLineageHash) {
    throw new Error("Adjusted Daily factor run lineage mismatch")
  }

  const run = toRun(runRow)
  const { data: transitionData, error: transitionError } = await input.supabase
    .from("market_price_adjustment_factors")
    .select("effective_session,cumulative_price_factor,cumulative_volume_factor")
    .eq("run_id", input.expectedFactorRunId)
    .eq("ticker", input.ticker)
    .order("effective_session", { ascending: true })

  if (transitionError || !Array.isArray(transitionData)) {
    throw new Error("Adjusted Daily factor transitions could not be loaded")
  }
  const transitions = (transitionData as FactorTransitionRow[]).map(toTransition)

  let canonicalRaw: CanonicalRawDailyBar[]
  try {
    canonicalRaw = await readCanonicalRawDaily(input.supabase, {
      ticker: input.ticker,
      from: input.fromDate,
      to: input.toDate,
    })
  } catch {
    throw new Error("Adjusted Daily canonical RAW range could not be loaded")
  }

  const rawBars = canonicalRaw.map(toRawDaily)
  const sessionSet = new Set<string>()
  for (const raw of rawBars) {
    if (raw.sessionDate < input.fromDate || raw.sessionDate > input.toDate) {
      throw new Error("Adjusted Daily raw session is outside the requested range")
    }
    if (sessionSet.has(raw.sessionDate)) {
      throw new Error("Adjusted Daily raw range contains duplicate canonical sessions")
    }
    sessionSet.add(raw.sessionDate)
  }

  const adjusted = rawBars.map((raw) => applyDailyAdjustment({ raw, run, transitions }))
  const rebuiltAt = new Date().toISOString()
  const payload = adjusted.map((bar) => ({
    ticker: bar.ticker,
    session_date: bar.sessionDate,
    bar_time: bar.barTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    raw_bar_time: bar.rawBarTime,
    factor_run_id: bar.factorRunId,
    factor_version: bar.factorVersion,
    event_lineage_hash: bar.eventLineageHash,
    adjustment_engine_version: bar.adjustmentEngineVersion,
    rebuilt_at: rebuiltAt,
  }))

  if (payload.length > 0) {
    const { error: persistError } = await input.supabase
      .from("market_ohlcv_adjusted_daily")
      .upsert(payload, { onConflict: "ticker,session_date" })
    if (persistError) throw new Error("Adjusted Daily persistence failed")
  }

  const { data: readbackData, error: readbackError } = await input.supabase.rpc(
    "qeo_adjusted_daily_readback",
    {
      p_ticker: input.ticker,
      p_from: input.fromDate,
      p_to: input.toDate,
      p_factor_run_id: input.expectedFactorRunId,
      p_lineage_hash: input.expectedLineageHash,
    },
  )

  const rows = !readbackError && Array.isArray(readbackData)
    ? readbackData as ReadbackRow[]
    : []
  const rowsBySession = new Map<string, ReadbackRow[]>()
  for (const row of rows) {
    const existing = rowsBySession.get(row.session_date) ?? []
    existing.push(row)
    rowsBySession.set(row.session_date, existing)
  }

  const unresolvedSessions: string[] = []
  for (const bar of adjusted) {
    const candidates = rowsBySession.get(bar.sessionDate) ?? []
    if (
      candidates.length !== 1
      || !readbackMatches(candidates[0], {
        sessionDate: bar.sessionDate,
        barTime: bar.barTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        rawBarTime: bar.rawBarTime,
        factorRunId: run.id,
        factorVersion: run.factorVersion,
        lineageHash: run.eventLineageHash,
        engineVersion: run.engineVersion,
      })
    ) {
      unresolvedSessions.push(bar.sessionDate)
    }
  }

  const firstSession = adjusted[0]?.sessionDate ?? null
  const lastSession = adjusted[adjusted.length - 1]?.sessionDate ?? null

  if (adjusted.length === 0 || unresolvedSessions.length > 0) {
    await persistRollout(input.supabase, {
      ticker: input.ticker,
      status: "blocked",
      factor_run_id: run.id,
      factor_version: run.factorVersion,
      event_lineage_hash: run.eventLineageHash,
      verified_from: null,
      verified_through: null,
      verified_at: null,
      activated_at: null,
      blocked_reason: adjusted.length === 0 ? "NO_CANONICAL_RAW_DAILY_SESSIONS" : "PERSISTED_READBACK_MISMATCH",
    })
  } else {
    await persistRollout(input.supabase, {
      ticker: input.ticker,
      status: "shadow",
      factor_run_id: run.id,
      factor_version: run.factorVersion,
      event_lineage_hash: run.eventLineageHash,
      verified_from: firstSession,
      verified_through: lastSession,
      verified_at: new Date().toISOString(),
      activated_at: null,
      blocked_reason: null,
    })
  }

  return {
    rebuiltSessions: adjusted.length - unresolvedSessions.length,
    unresolvedSessions,
    firstSession,
    lastSession,
    factorRunId: run.id,
    factorVersion: run.factorVersion,
    lineageHash: run.eventLineageHash,
  }
}
