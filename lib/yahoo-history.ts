import type { OhlcvBar } from "./technical-indicators.ts"
import { normalizeFiveMinuteBars, previousSessionClose, selectLatestSession } from "./intraday-5m.ts"
import { normalizeToKiloPrice, normalizeVolume } from "./market-data-contract.ts"

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

type YahooOhlcvResult = {
  bars: OhlcvBar[]
  previousClose: number | null
}

async function fetchYahooOhlcvResult(symbol: string, interval: "1d" | "60m" | "5m", lookbackDays: number, now = new Date()): Promise<YahooOhlcvResult> {
  const period2 = Math.floor(now.getTime() / 1000)
  const period1 = period2 - lookbackDays * 86400
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.toUpperCase()}.VN?period1=${period1}&period2=${period2}&interval=${interval}&events=history&includeAdjustedClose=true`
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 StockOS/1.0" }, next: { revalidate: 60 } })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN failed (${res.status}): ${text.slice(0, 120)}`)
  }
  const json = await res.json()
  const result = json.chart?.result?.[0]
  if (!result) {
    throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no chart result`)
  }

  const timestamps = result.timestamp || []
  const quote = result?.indicators?.quote?.[0] ?? {}
  const bars: OhlcvBar[] = []
  for (let i = 0; i < timestamps.length; i += 1) {
    const time = finite(timestamps[i])
    const open = normalizeToKiloPrice(finite(quote.open?.[i]))
    const high = normalizeToKiloPrice(finite(quote.high?.[i]))
    const low = normalizeToKiloPrice(finite(quote.low?.[i]))
    const close = normalizeToKiloPrice(finite(quote.close?.[i]))
    const volume = normalizeVolume(finite(quote.volume?.[i]))
    if ([time, open, high, low, close].some((value) => value == null || value <= 0) || volume < 0) continue
    bars.push({
      time: time as number,
      open: open as number,
      high: (high ?? close) as number,
      low: (low ?? close) as number,
      close: close as number,
      volume,
    })
  }

  const rawPrev = finite(result?.meta?.previousClose) ?? finite(result?.meta?.chartPreviousClose)
  const metaPreviousClose = normalizeToKiloPrice(rawPrev)
  return {
    bars: bars.sort((a, b) => a.time - b.time),
    previousClose: metaPreviousClose && metaPreviousClose > 0 ? metaPreviousClose : null,
  }
}

async function fetchYahooOhlcv(symbol: string, interval: "1d" | "60m" | "5m", lookbackDays: number, now = new Date()) {
  return (await fetchYahooOhlcvResult(symbol, interval, lookbackDays, now)).bars
}

function vietnamDateParts(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs))
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return {
    weekday: value("weekday"),
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  }
}

export function isVietnamTradingDay(now = new Date()) {
  const { weekday } = vietnamDateParts(now.getTime())
  return weekday !== "Sat" && weekday !== "Sun"
}

export function isPastVietnamSessionOpen(now = new Date()) {
  const { hour } = vietnamDateParts(now.getTime())
  return hour >= 9
}

export function isTradingSessionActiveOrPastOpen(now = new Date()) {
  return isVietnamTradingDay(now) && isPastVietnamSessionOpen(now)
}

export function vietnamSessionStartSeconds(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  // Vietnam is UTC+7, so 09:00 ICT is 02:00 UTC
  return Math.floor(Date.UTC(year, month - 1, day, 2, 0, 0) / 1000)
}

export type YahooFiveMinuteSnapshot = {
  bars: OhlcvBar[]
  reference: number
  sessionDate: string
}

export async function fetchYahooFiveMinuteSnapshot(symbol: string, now = new Date()): Promise<YahooFiveMinuteSnapshot> {
  const today = vietnamDateKey(now.getTime())
  const raw = await fetchYahooOhlcvResult(symbol, "5m", 7, now)
  const dateOf = (bar: OhlcvBar) => vietnamDateKey(bar.time * 1000)
  const session = selectLatestSession(raw.bars, today, dateOf)
  if (!session?.items.length) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no usable recent 5m session`)

  // At 9:00 AM on a trading day, a new session starts. If Yahoo does not yet have bars for today,
  // reset to yesterday's EOD close as today's reference price and start with a flat reference baseline.
  if (isTradingSessionActiveOrPastOpen(now) && session.date < today) {
    const yesterdayClose = session.items.at(-1)?.close ?? raw.previousClose
    if (yesterdayClose && yesterdayClose > 0) {
      const sessionStart = vietnamSessionStartSeconds(today)
      const resetBars: OhlcvBar[] = [
        { time: sessionStart, open: yesterdayClose, high: yesterdayClose, low: yesterdayClose, close: yesterdayClose, volume: 0 },
        { time: sessionStart + 300, open: yesterdayClose, high: yesterdayClose, low: yesterdayClose, close: yesterdayClose, volume: 0 },
      ]
      return { bars: resetBars, reference: yesterdayClose, sessionDate: today }
    }
  }

  const sessionEnd = vietnamSessionEndSeconds(session.date)
  const endTime = session.date === today && !marketClosed(now)
    ? Math.min(now.getTime() / 1000, sessionEnd)
    : sessionEnd
  const bars = normalizeFiveMinuteBars(session.items, endTime)
  if (!bars.length) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no usable 5m bars for ${session.date}`)

  const priorClose = previousSessionClose(raw.bars, session.date, dateOf, (bar) => bar.close)
  const reference = priorClose ?? raw.previousClose
  if (!reference || reference <= 0) throw new Error(`Yahoo OHLC ${symbol.toUpperCase()}.VN returned no prior-session reference for ${session.date}`)
  return { bars, reference, sessionDate: session.date }
}

export async function fetchYahooFiveMinuteOhlcv(symbol: string, now = new Date()): Promise<OhlcvBar[]> {
  return (await fetchYahooFiveMinuteSnapshot(symbol, now)).bars
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