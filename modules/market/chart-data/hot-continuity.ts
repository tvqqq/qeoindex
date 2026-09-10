import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  bootstrapChartIntradayChunk,
  type Qeo107BootstrapChunkResult,
} from "./bootstrap"
import {
  qeo150SessionRange,
  qeo180ExpectedHotSessions,
  qeo180MissingHotSessions,
} from "./maintenance-policy"

export interface Qeo180MissingHotSession {
  ticker: string
  sessionDate: string
  sessionIndex: number
}

export interface Qeo180HotContinuityPlan {
  expectedSessions: string[]
  currentExpectedSession: string
  historicalExpectedSessions: string[]
  missingHotSessions: Qeo180MissingHotSession[]
}

function validTicker(input: string) {
  const ticker = String(input || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid QEO-180 ticker: ${input}`)
  return ticker
}

function dateOnly(value: unknown) {
  const raw = String(value ?? "")
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null
}

async function readSessionPresence(
  supabase: SupabaseClient,
  tickers: string[],
  sessionDate: string,
) {
  const { data, error } = await supabase.rpc("qeo_chart_intraday_session_coverage", {
    p_tickers: tickers,
    p_hot_cutoff: new Date(`${sessionDate}T00:00:00+07:00`).toISOString(),
  })
  if (error) throw new Error(`QEO-180 HOT session presence failed for ${sessionDate}: ${error.message}`)
  const present = new Set<string>()
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const ticker = validTicker(String(row.ticker || ""))
    if (dateOnly(row.first_hot_session) === sessionDate) present.add(ticker)
  }
  return present
}

export async function readQeo180MissingHotSessions(
  supabase: SupabaseClient,
  input: { tickers: string[]; referenceAt?: Date },
): Promise<Qeo180HotContinuityPlan> {
  const tickers = [...new Set(input.tickers.map(validTicker))]
  const referenceAt = input.referenceAt ?? new Date()
  const expectedSessions = qeo180ExpectedHotSessions(referenceAt)
  const currentExpectedSession = expectedSessions.at(-1)!
  // QEO-150 remains the exclusive owner of current-session reconciliation.
  // QEO-180 only repairs the four older sessions in the same five-session HOT window.
  const historicalExpectedSessions = expectedSessions.slice(0, -1)
  if (!tickers.length) {
    return { expectedSessions, currentExpectedSession, historicalExpectedSessions, missingHotSessions: [] }
  }

  const presenceBySession = await Promise.all(
    historicalExpectedSessions.map(async (sessionDate) => ({
      sessionDate,
      present: await readSessionPresence(supabase, tickers, sessionDate),
    })),
  )

  const missingHotSessions: Qeo180MissingHotSession[] = []
  for (const ticker of tickers) {
    const presentSessions = presenceBySession
      .filter(({ present }) => present.has(ticker))
      .map(({ sessionDate }) => sessionDate)
    for (const sessionDate of qeo180MissingHotSessions(historicalExpectedSessions, presentSessions)) {
      missingHotSessions.push({
        ticker,
        sessionDate,
        sessionIndex: historicalExpectedSessions.indexOf(sessionDate),
      })
    }
  }

  return { expectedSessions, currentExpectedSession, historicalExpectedSessions, missingHotSessions }
}

export async function runQeo180HotContinuityRange(
  supabase: SupabaseClient,
  input: Qeo180MissingHotSession & { referenceAt: Date },
): Promise<Qeo107BootstrapChunkResult> {
  if (!Number.isFinite(input.referenceAt.getTime())) throw new Error("QEO-180 catch-up requires a valid referenceAt")
  const range = qeo150SessionRange(input.sessionDate)
  return bootstrapChartIntradayChunk(supabase, {
    ticker: input.ticker,
    chunk: {
      index: input.sessionIndex,
      from: range.from,
      to: range.to,
      class: "HOT_FIRST",
    },
    referenceAt: input.referenceAt,
  })
}
