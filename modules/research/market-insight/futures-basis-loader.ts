import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDnseIndexCandleHistory } from "@/modules/market/providers/dnse/index-candles"
import { candleDateKey } from "@/modules/market/realtime/index-candles"
import {
  buildFuturesBasisPulse,
  type FuturesBasisPulse,
  type FuturesBasisSessionPoint,
} from "@/modules/research/market-insight/futures-basis-pulse"

function dedupeFuturesSessions(points: FuturesBasisSessionPoint[]) {
  const byDate = new Map<string, FuturesBasisSessionPoint>()
  for (const point of points) byDate.set(point.sessionDate, point)
  return [...byDate.values()].sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
}

function targetSessionEnd(sessionDate: string) {
  return new Date(`${sessionDate}T16:00:00+07:00`)
}

export async function loadVn30FuturesBasisPulse(
  supabase: SupabaseClient,
  targetSessionDate: string,
): Promise<FuturesBasisPulse> {
  const [futuresResult, spotResult] = await Promise.allSettled([
    fetchDnseIndexCandleHistory("VN30F1M", targetSessionEnd(targetSessionDate), "1D", 8),
    supabase
      .from("market_insight_indexes")
      .select("session_date,value")
      .eq("index_code", "VN30")
      .lte("session_date", targetSessionDate)
      .order("session_date", { ascending: false })
      .limit(2),
  ])

  const futuresSessions = futuresResult.status === "fulfilled"
    ? dedupeFuturesSessions(futuresResult.value.bars.map((bar) => ({
      sessionDate: candleDateKey(bar.time),
      value: Number.isFinite(bar.close) && bar.close > 0 ? bar.close : null,
    })))
    : []

  const spotResponse = spotResult.status === "fulfilled" ? spotResult.value : null
  const spotSessions: FuturesBasisSessionPoint[] = !spotResponse?.error
    ? (spotResponse?.data ?? []).map((row) => {
      const value = Number(row.value)
      return {
        sessionDate: String(row.session_date),
        value: Number.isFinite(value) && value > 0 ? value : null,
      }
    })
    : []

  return buildFuturesBasisPulse({
    targetSessionDate,
    futuresSessions,
    spotSessions,
    futuresSource: futuresResult.status === "fulfilled"
      ? `DNSE VN30F1M · ${futuresResult.value.transport} · EOD 1D`
      : "DNSE VN30F1M · EOD 1D unavailable",
    spotSource: "Market Insights VN30 · persisted EOD",
  })
}

export async function loadVn30FuturesBasisPulseLatest(
  supabase: SupabaseClient,
): Promise<FuturesBasisPulse | null> {
  const latest = await supabase
    .from("market_insight_daily")
    .select("session_date")
    .order("session_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest.error || !latest.data?.session_date) return null
  return loadVn30FuturesBasisPulse(supabase, String(latest.data.session_date))
}
