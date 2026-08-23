import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { fetchDnseIndexCandleHistory } from "@/lib/dnse-index-candles"
import type { CouncilMarketRegime } from "@/lib/ai-council-calibration"

const VIETNAM_TZ = "Asia/Ho_Chi_Minh"

export interface CouncilBenchmarkContext {
  symbol: "VNINDEX"
  sessionDate: string | null
  close: number | null
  sma20: number | null
  return20dPct: number | null
  regime: CouncilMarketRegime
  providerDetail: string
}

export interface CouncilBenchmarkSyncResult extends CouncilBenchmarkContext {
  rowsUpserted: number
}

function dateKey(timestampSeconds: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampSeconds * 1000))
}

function regimeFor(close: number, sma20: number | null, return20dPct: number | null): CouncilMarketRegime {
  if (sma20 == null || return20dPct == null) return "UNKNOWN"
  if (close > sma20 && return20dPct > 2) return "RISK_ON"
  if (close < sma20 && return20dPct < -2) return "RISK_OFF"
  return "NEUTRAL"
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function syncAiCouncilMarketBenchmark(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<CouncilBenchmarkSyncResult> {
  const history = await fetchDnseIndexCandleHistory("VNINDEX", now, "1D", 360)
  const bars = history.bars
  if (!bars.length) throw new Error("VNINDEX daily benchmark returned no bars")

  const fetchedAt = now.toISOString()
  const rows = bars.map((bar, index) => {
    const window = bars.slice(Math.max(0, index - 19), index + 1)
    const sma20 = window.length === 20
      ? window.reduce((sum, item) => sum + item.close, 0) / 20
      : null
    const prior20 = index >= 20 ? bars[index - 20].close : null
    const return20dPct = prior20 != null && prior20 > 0 ? ((bar.close / prior20) - 1) * 100 : null
    return {
      symbol: "VNINDEX",
      session_date: dateKey(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      sma20,
      return_20d_pct: return20dPct,
      regime: regimeFor(bar.close, sma20, return20dPct),
      provider: "DNSE",
      provider_detail: history.transport,
      fetched_at: fetchedAt,
      updated_at: fetchedAt,
    }
  })

  const upsert = await supabase
    .from("ai_council_market_benchmarks")
    .upsert(rows, { onConflict: "symbol,session_date" })
  if (upsert.error) throw new Error(`Persist VNINDEX benchmark failed: ${upsert.error.message}`)

  const latest = rows[rows.length - 1]
  return {
    symbol: "VNINDEX",
    rowsUpserted: rows.length,
    sessionDate: latest.session_date,
    close: latest.close,
    sma20: latest.sma20,
    return20dPct: latest.return_20d_pct,
    regime: latest.regime,
    providerDetail: history.transport,
  }
}

export async function loadAiCouncilBenchmarkContext(
  supabase: SupabaseClient,
  asOfDate: string,
): Promise<CouncilBenchmarkContext> {
  const result = await supabase
    .from("ai_council_market_benchmarks")
    .select("session_date,close,sma20,return_20d_pct,regime,provider_detail")
    .eq("symbol", "VNINDEX")
    .lte("session_date", asOfDate)
    .order("session_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (result.error || !result.data) {
    return {
      symbol: "VNINDEX",
      sessionDate: null,
      close: null,
      sma20: null,
      return20dPct: null,
      regime: "UNKNOWN",
      providerDetail: result.error ? `Benchmark unavailable: ${result.error.message}` : "No persisted VNINDEX benchmark",
    }
  }

  const regime = result.data.regime
  return {
    symbol: "VNINDEX",
    sessionDate: result.data.session_date as string,
    close: nullableNumber(result.data.close),
    sma20: nullableNumber(result.data.sma20),
    return20dPct: nullableNumber(result.data.return_20d_pct),
    regime: regime === "RISK_ON" || regime === "NEUTRAL" || regime === "RISK_OFF" ? regime : "UNKNOWN",
    providerDetail: String(result.data.provider_detail || "DNSE"),
  }
}
