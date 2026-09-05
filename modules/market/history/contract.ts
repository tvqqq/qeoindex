import type { OhlcvBar } from "../../shared/technical/indicators.ts"

export type HistoricalProvider = "DNSE" | "Fallback" | "VNDirect" | "VCI" | "TitanLabs"
export type RawHistoryTimeframe = "1D" | "1H"

export interface HistoricalBarsResult {
  bars: OhlcvBar[]
  provider: HistoricalProvider
  detail: string
  sourceUrl: string
  fetchedAt: string
}

export const DAILY_BACKFILL_DAYS = 8 * 366
export const HOURLY_BACKFILL_DAYS = 180
export const DAILY_DELTA_DAYS = 14
export const HOURLY_DELTA_DAYS = 7

function normalizedTicker(symbol: string) {
  return symbol.trim().toUpperCase()
}

function windowSeconds(lookbackDays: number, now: Date) {
  const to = Math.floor(now.getTime() / 1000)
  const from = to - Math.max(1, Math.floor(lookbackDays)) * 86400
  return { from, to }
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export function buildHistoricalSourceUrl(
  provider: HistoricalProvider,
  symbol: string,
  timeframe: RawHistoryTimeframe,
  lookbackDays: number,
  now: Date = new Date(),
  options: { dnseBaseUrl?: string } = {},
) {
  const ticker = normalizedTicker(symbol)
  const { from, to } = windowSeconds(lookbackDays, now)

  if (provider === "VCI") {
    if (timeframe !== "1D") throw new Error(`VCI canonical history provider does not support ${timeframe}`)
    const url = new URL("https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart")
    url.searchParams.set("timeFrame", "ONE_DAY")
    url.searchParams.set("symbol", ticker)
    url.searchParams.set("to", String(to))
    url.searchParams.set("countBack", String(Math.min(15000, Math.max(30, Math.floor(lookbackDays) + 10))))
    return url.toString()
  }

  if (provider === "DNSE") {
    const baseUrl = (options.dnseBaseUrl || "https://openapi.dnse.com.vn").replace(/\/$/, "")
    const url = new URL(`${baseUrl}/price/ohlc`)
    url.searchParams.set("symbol", ticker)
    url.searchParams.set("resolution", timeframe)
    url.searchParams.set("from", String(from))
    url.searchParams.set("to", String(to))
    url.searchParams.set("type", "STOCK")
    return url.toString()
  }

  if (provider === "VNDirect") {
    if (timeframe !== "1D") throw new Error(`VNDirect history provider does not support ${timeframe}`)
    const safeLookbackDays = Math.max(1, Math.floor(lookbackDays))
    const fromDate = vietnamDateKey(new Date(now.getTime() - safeLookbackDays * 86400 * 1000))
    const toDate = vietnamDateKey(now)
    const url = new URL("https://finfo-api.vndirect.com.vn/v4/stock_prices")
    url.searchParams.set("sort", "date")
    url.searchParams.set("q", `code:${ticker}~date:gte:${fromDate}~date:lte:${toDate}`)
    url.searchParams.set("size", String(Math.min(5000, safeLookbackDays + 2)))
    url.searchParams.set("page", "1")
    return url.toString()
  }

  if (provider === "TitanLabs") {
    if (timeframe !== "1D") throw new Error(`TitanLabs history provider does not support ${timeframe}`)
    const url = new URL("https://www.titanlabs.vn/api/charts/series")
    url.searchParams.set("symbol", ticker)
    return url.toString()
  }

  const interval = timeframe === "1D" ? "1d" : "60m"
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.VN`)
  url.searchParams.set("period1", String(from))
  url.searchParams.set("period2", String(to))
  url.searchParams.set("interval", interval)
  url.searchParams.set("events", "history")
  url.searchParams.set("includeAdjustedClose", "true")
  return url.toString()
}
