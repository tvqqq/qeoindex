import type { OhlcvBar } from "@/lib/technical-indicators"
import { normalizeFiveMinuteBars, selectLatestSession } from "@/lib/intraday-5m"

const DEFAULT_LOOKBACK_DAYS = 620
const DEFAULT_HOURLY_LOOKBACK_DAYS = 180

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function vietnamDateKey(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return `${value("year")}-${value("month")}-${value("day")}`
}

function marketClosed(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  return hour > 15 || (hour === 15 && minute >= 30)
}

function vietnamSessionEndSeconds(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return Date.UTC(year, month - 1, day, 8, 0, 0) / 1000
}

async function fetchYahooOhlcv(symbol: string, interval: "1d" | "60m" | "5m", lookbackDays: number, now = new Date()) {
  const period2 = Math.floor(now.getTime() / 1000) + (interval === "1d" ? 86400 : interval === "60m" ? 3600 : 300)
  const period1 = period2 - lookbackDays * 86400
  const ticker = `${symbol.toUpperCase()}.VN`
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`)
  url.searchParams.set("period1", String(period1))
  url.searchParams.set("period2", String(period2))
  url.searchParams.set("interval", interval)
  url.searchParams.set("events", "history")
  url.searchParams.set("includeAdjustedClose", "true")

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "StockOS/1.0 research-scanner",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Yahoo OHLC ${ticker} ${interval} failed (${response.status}): ${body.slice(0, 160)}`)

  const payload = JSON.parse(body)
  const result = payload?.chart?.result?.[0]
  if (!result) {
    const description = payload?.chart?.error?.description ?? "no chart result"
    throw new Error(`Yahoo OHLC ${ticker}: ${description}`)
  }

  const timestamps: unknown[] = result.timestamp ?? []
  const quote = result?.indicators?.quote?.[0] ?? {}
  const bars: OhlcvBar[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const time = finite(timestamps[i])
    const open = finite(quote.open?.[i])
    const high = finite(quote.high?.[i])
    const low = finite(quote.low?.[i])
    const close = finite(quote.close?.[i])
    const volume = finite(quote.volume?.[i])
    if ([time, open, high, low, close].some((value) => value == null || value <= 0) || volume == null || volume < 0) continue
    bars.push({
      time: time as number,
      open: open as number,
      high: high as number,
      low: low as number,
      close: close as number,
      volume: volume as number,
    })
  }
  return bars.sort((a, b) => a.time - b.time)
}

export async function fetchYahooFiveMinuteOhlcv(symbol: string, now = new Date()): Promise<OhlcvBar[]> {
  const today = vietnamDateKey(now.getTime())
  const session = selectLatestSession(await fetchYahooOhlcv(symbol, "5m", 7, now), today, (bar) => vietnamDateKey(bar.time * 1000))
  if (!session?.items.length) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no usable recent 5m session`)
  const sessionEnd = vietnamSessionEndSeconds(session.date)
  const endTime = session.date === today && !marketClosed(now)
    ? Math.min(now.getTime() / 1000, sessionEnd)
    : sessionEnd
  const bars = normalizeFiveMinuteBars(session.items, endTime)
  if (!bars.length) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no usable 5m bars for ${session.date}`)
  return bars
}

export async function fetchYahooDailyOhlcv(symbol: string, now = new Date()): Promise<OhlcvBar[]> {
  let bars = await fetchYahooOhlcv(symbol, "1d", DEFAULT_LOOKBACK_DAYS, now)
  if (!marketClosed(now)) {
    const today = vietnamDateKey(now.getTime())
    bars = bars.filter((bar) => vietnamDateKey(bar.time * 1000) !== today)
  }
  if (!bars.length) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no usable completed daily bars`)
  return bars
}

export async function fetchYahooHourlyOhlcv(symbol: string, now = new Date()): Promise<OhlcvBar[]> {
  let bars = await fetchYahooOhlcv(symbol, "60m", DEFAULT_HOURLY_LOOKBACK_DAYS, now)
  const nowSeconds = Math.floor(now.getTime() / 1000)
  bars = bars.filter((bar, index) => index !== bars.length - 1 || bar.time + 3600 <= nowSeconds)
  if (bars.length < 2) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned insufficient completed hourly bars`)
  return bars
}
