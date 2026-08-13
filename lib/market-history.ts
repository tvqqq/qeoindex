import type { OhlcvBar } from "@/lib/technical-indicators"
import { fetchDailyOhlcv as fetchDnseDailyOhlcv } from "@/lib/dnse-history"
import { fetchYahooDailyOhlcv } from "@/lib/yahoo-history"

export type HistoricalProvider = "DNSE" | "Fallback"

export interface HistoricalBarsResult {
  bars: OhlcvBar[]
  provider: HistoricalProvider
  detail: string
}

export async function fetchDailyMarketHistory(symbol: string, now = new Date()): Promise<HistoricalBarsResult> {
  const errors: string[] = []
  try {
    const bars = await fetchDnseDailyOhlcv(symbol, now)
    return { bars, provider: "DNSE", detail: "DNSE OpenAPI" }
  } catch (error) {
    errors.push(`DNSE: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const bars = await fetchYahooDailyOhlcv(symbol, now)
    return { bars, provider: "Fallback", detail: "Yahoo Finance .VN fallback" }
  } catch (error) {
    errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join(" | ").slice(0, 520))
}
