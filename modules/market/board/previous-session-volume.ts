import "server-only"

import { previousTradingSessionDateKey } from "@/modules/market/board/market-context-metrics"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

const VOLUME_BASELINE_TIMEOUT_MS = 1_000

/** Exact prior completed 1D session, not today's partial volume or a 50D average. */
export async function getPreviousSessionVolumes(
  symbols: readonly string[],
  currentDay: string,
): Promise<Record<string, number>> {
  const previousDay = previousTradingSessionDateKey(currentDay)
  const client = getSupabaseServerClient()
  if (!previousDay || !client) return {}

  const tickers = [...new Set(symbols.filter((symbol) => /^[A-Z0-9]{2,12}$/.test(symbol)))].slice(0, 200)
  if (!tickers.length) return {}

  const nextDay = new Date(`${previousDay}T00:00:00.000Z`)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)

  try {
    const { data, error } = await client
      .from("market_ohlcv_history")
      .select("ticker,bar_time,volume")
      .eq("timeframe", "1D")
      .in("ticker", tickers)
      .gte("bar_time", `${previousDay}T00:00:00.000Z`)
      .lt("bar_time", nextDay.toISOString())
      .limit(200)
      .abortSignal(AbortSignal.timeout(VOLUME_BASELINE_TIMEOUT_MS))

    if (error || !data) return {}
    const result: Record<string, number> = {}
    for (const row of data) {
      const ticker = String(row.ticker || "")
      const volume = Number(row.volume)
      if (tickers.includes(ticker) && row.volume != null && Number.isFinite(volume) && volume > 0) {
        result[ticker] = volume
      }
    }
    return result
  } catch {
    // A delayed/missing EOD store should not block a realtime board render.
    return {}
  }
}
