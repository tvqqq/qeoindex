import type { OhlcvBar } from "@/lib/technical-indicators"
import { fetchDailyOhlcv as fetchDnseDailyOhlcv, fetchHourlyOhlcv as fetchDnseHourlyOhlcv } from "@/lib/dnse-history"
import { fetchYahooDailyOhlcv, fetchYahooHourlyOhlcv } from "@/lib/yahoo-history"

export type HistoricalProvider = "DNSE" | "Fallback"

export interface HistoricalBarsResult {
  bars: OhlcvBar[]
  provider: HistoricalProvider
  detail: string
}

let dnseUnavailableUntil = 0

function shouldTryDnse() {
  return Date.now() >= dnseUnavailableUntil
}

function markDnseUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(message)) {
    dnseUnavailableUntil = Date.now() + 5 * 60_000
  }
  return message
}

export async function fetchDailyMarketHistory(symbol: string, now = new Date()): Promise<HistoricalBarsResult> {
  const errors: string[] = []
  if (shouldTryDnse()) {
    try {
      const bars = await fetchDnseDailyOhlcv(symbol, now)
      return { bars, provider: "DNSE", detail: "DNSE OpenAPI · 1D" }
    } catch (error) {
      errors.push(`DNSE: ${markDnseUnavailable(error)}`)
    }
  } else {
    errors.push("DNSE: temporarily bypassed after network failure")
  }

  try {
    const bars = await fetchYahooDailyOhlcv(symbol, now)
    return { bars, provider: "Fallback", detail: "Yahoo Finance .VN fallback · 1D" }
  } catch (error) {
    errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join(" | ").slice(0, 520))
}

export async function fetchHourlyMarketHistory(symbol: string, now = new Date()): Promise<HistoricalBarsResult> {
  const errors: string[] = []
  if (shouldTryDnse()) {
    try {
      const bars = await fetchDnseHourlyOhlcv(symbol, now)
      return { bars, provider: "DNSE", detail: "DNSE OpenAPI · 1H completed bars" }
    } catch (error) {
      errors.push(`DNSE: ${markDnseUnavailable(error)}`)
    }
  } else {
    errors.push("DNSE: temporarily bypassed after network failure")
  }

  try {
    const bars = await fetchYahooHourlyOhlcv(symbol, now)
    return { bars, provider: "Fallback", detail: "Yahoo Finance .VN fallback · 60m completed bars" }
  } catch (error) {
    errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join(" | ").slice(0, 520))
}
