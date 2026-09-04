import type { OhlcvBar } from "@/lib/technical-indicators"
import { fetchDailyOhlcv as fetchDnseDailyOhlcv, fetchHourlyOhlcv as fetchDnseHourlyOhlcv } from "@/modules/market/providers/dnse/history"
import { fetchVnDirectDailyOhlcv } from "@/lib/vndirect-history"
import { fetchYahooDailyOhlcv, fetchYahooHourlyOhlcv } from "@/modules/market/providers/yahoo/history"
import { readThroughUiCache } from "@/modules/shared/cache/ui-data-cache"
import {
  buildHistoricalSourceUrl,
  DAILY_BACKFILL_DAYS,
  HOURLY_BACKFILL_DAYS,
  type HistoricalBarsResult,
  type HistoricalProvider,
  type RawHistoryTimeframe,
} from "@/modules/market/history/contract"

export type { HistoricalBarsResult, HistoricalProvider, RawHistoryTimeframe } from "@/modules/market/history/contract"

let dnseUnavailableUntil = 0

function shouldTryDnse() {
  return Date.now() >= dnseUnavailableUntil
}

function markDnseUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|adaptive deadline exceeded/i.test(message)) {
    dnseUnavailableUntil = Date.now() + 5 * 60_000
  }
  return message
}

function isHistoricalBarsResult(value: unknown): value is HistoricalBarsResult {
  if (!value || typeof value !== "object") return false
  const result = value as Partial<HistoricalBarsResult>
  return Array.isArray(result.bars)
    && result.bars.length > 0
    && (result.provider === "DNSE" || result.provider === "Fallback" || result.provider === "VNDirect")
    && typeof result.detail === "string"
    && typeof result.sourceUrl === "string"
    && typeof result.fetchedAt === "string"
}

function historicalResult(input: {
  bars: OhlcvBar[]
  provider: HistoricalProvider
  detail: string
  symbol: string
  timeframe: RawHistoryTimeframe
  lookbackDays: number
  now: Date
}): HistoricalBarsResult {
  return {
    bars: input.bars,
    provider: input.provider,
    detail: input.detail,
    sourceUrl: buildHistoricalSourceUrl(
      input.provider,
      input.symbol,
      input.timeframe,
      input.lookbackDays,
      input.now,
      { dnseBaseUrl: process.env.DNSE_API_BASE_URL },
    ),
    fetchedAt: new Date().toISOString(),
  }
}

export async function fetchDailyMarketHistoryWindow(
  symbol: string,
  lookbackDays: number,
  now = new Date(),
): Promise<HistoricalBarsResult> {
  const errors: string[] = []
  if (shouldTryDnse()) {
    try {
      const bars = await fetchDnseDailyOhlcv(symbol, now, lookbackDays)
      return historicalResult({ bars, provider: "DNSE", detail: `DNSE OpenAPI · 1D · ${lookbackDays}d window`, symbol, timeframe: "1D", lookbackDays, now })
    } catch (error) {
      errors.push(`DNSE: ${markDnseUnavailable(error)}`)
    }
  } else {
    errors.push("DNSE: temporarily bypassed after network failure")
  }

  try {
    const bars = await fetchYahooDailyOhlcv(symbol, now, lookbackDays)
    return historicalResult({ bars, provider: "Fallback", detail: `Yahoo Finance .VN fallback · 1D · ${lookbackDays}d window`, symbol, timeframe: "1D", lookbackDays, now })
  } catch (error) {
    errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const bars = await fetchVnDirectDailyOhlcv(symbol, now, lookbackDays)
    return historicalResult({ bars, provider: "VNDirect", detail: `VNDirect Finfo fallback · 1D · ${lookbackDays}d window`, symbol, timeframe: "1D", lookbackDays, now })
  } catch (error) {
    errors.push(`VNDirect: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join(" | ").slice(0, 720))
}

export async function fetchHourlyMarketHistoryWindow(
  symbol: string,
  lookbackDays: number,
  now = new Date(),
): Promise<HistoricalBarsResult> {
  const errors: string[] = []
  if (shouldTryDnse()) {
    try {
      const bars = await fetchDnseHourlyOhlcv(symbol, now, lookbackDays)
      return historicalResult({ bars, provider: "DNSE", detail: `DNSE OpenAPI · 1H · ${lookbackDays}d window`, symbol, timeframe: "1H", lookbackDays, now })
    } catch (error) {
      errors.push(`DNSE: ${markDnseUnavailable(error)}`)
    }
  } else {
    errors.push("DNSE: temporarily bypassed after network failure")
  }

  try {
    const bars = await fetchYahooHourlyOhlcv(symbol, now, lookbackDays)
    return historicalResult({ bars, provider: "Fallback", detail: `Yahoo Finance .VN fallback · 60m · ${lookbackDays}d window`, symbol, timeframe: "1H", lookbackDays, now })
  } catch (error) {
    errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join(" | ").slice(0, 520))
}

export async function fetchDailyMarketHistory(symbol: string, now = new Date()): Promise<HistoricalBarsResult> {
  const errors: string[] = []
  if (shouldTryDnse()) {
    try {
      const bars = await fetchDnseDailyOhlcv(symbol, now)
      return historicalResult({ bars, provider: "DNSE", detail: "DNSE OpenAPI · 1D", symbol, timeframe: "1D", lookbackDays: 520, now })
    } catch (error) {
      errors.push(`DNSE: ${markDnseUnavailable(error)}`)
    }
  } else {
    errors.push("DNSE: temporarily bypassed after network failure")
  }

  try {
    const bars = await fetchYahooDailyOhlcv(symbol, now)
    return historicalResult({ bars, provider: "Fallback", detail: "Yahoo Finance .VN fallback · 1D", symbol, timeframe: "1D", lookbackDays: 620, now })
  } catch (error) {
    errors.push(`Yahoo: ${error instanceof Error ? error.message : String(error)}`)
  }

  try {
    const bars = await fetchVnDirectDailyOhlcv(symbol, now, 620)
    return historicalResult({ bars, provider: "VNDirect", detail: "VNDirect Finfo fallback · 1D", symbol, timeframe: "1D", lookbackDays: 620, now })
  } catch (error) {
    errors.push(`VNDirect: ${error instanceof Error ? error.message : String(error)}`)
  }

  throw new Error(errors.join(" | ").slice(0, 720))
}

/** Selected-ticker chart path and initial persistent-cache backfill. */
export async function fetchLongDailyMarketHistory(symbol: string, now = new Date()): Promise<HistoricalBarsResult> {
  const result = await fetchDailyMarketHistoryWindow(symbol, DAILY_BACKFILL_DAYS, now)
  const detail = result.provider === "DNSE"
    ? "DNSE OpenAPI · 1D · 8-year Wyckoff window"
    : result.provider === "VNDirect"
      ? "VNDirect Finfo fallback · 1D · 8-year Wyckoff window"
      : "Yahoo Finance .VN fallback · 1D · 8-year Wyckoff window"
  return { ...result, detail }
}

export async function fetchHourlyMarketHistory(symbol: string, now = new Date()): Promise<HistoricalBarsResult> {
  const result = await fetchHourlyMarketHistoryWindow(symbol, HOURLY_BACKFILL_DAYS, now)
  return {
    ...result,
    detail: result.provider === "DNSE"
      ? "DNSE OpenAPI · 1H completed bars"
      : "Yahoo Finance .VN fallback · 60m completed bars",
  }
}

/** UI-only cross-request history caches. Scanner/signal paths keep using fresh functions above. */
export async function fetchDailyMarketHistoryUi(symbol: string): Promise<HistoricalBarsResult> {
  const normalized = symbol.trim().toUpperCase()
  return readThroughUiCache({
    namespace: "market-history-ui-v1",
    key: `daily:${normalized}`,
    tag: "qeoindex-market-history-ui-v1",
    name: `QeoIndex ${normalized} Daily history`,
    ttlSeconds: 15 * 60,
    validate: isHistoricalBarsResult,
    load: () => fetchDailyMarketHistory(normalized),
  })
}

export async function fetchHourlyMarketHistoryUi(symbol: string): Promise<HistoricalBarsResult> {
  const normalized = symbol.trim().toUpperCase()
  return readThroughUiCache({
    namespace: "market-history-ui-v1",
    key: `hourly:${normalized}`,
    tag: "qeoindex-market-history-ui-v1",
    name: `QeoIndex ${normalized} Hourly history`,
    ttlSeconds: 5 * 60,
    validate: isHistoricalBarsResult,
    load: () => fetchHourlyMarketHistory(normalized),
  })
}

export async function fetchLongDailyMarketHistoryUi(symbol: string): Promise<HistoricalBarsResult> {
  const normalized = symbol.trim().toUpperCase()
  return readThroughUiCache({
    namespace: "market-history-ui-v1",
    key: `daily-long:${normalized}`,
    tag: "qeoindex-market-history-ui-v1",
    name: `QeoIndex ${normalized} long Daily Wyckoff history`,
    ttlSeconds: 30 * 60,
    validate: isHistoricalBarsResult,
    load: () => fetchLongDailyMarketHistory(normalized),
  })
}
