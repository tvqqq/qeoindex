import "server-only"

import type { OhlcvBar } from "@/lib/technical-indicators"

const VNDIRECT_STOCK_PRICES_URL = "https://finfo-api.vndirect.com.vn/v4/stock_prices"
const VNDIRECT_REQUEST_TIMEOUT_MS = 15_000
const VNDIRECT_MAX_ROWS = 5_000
const MILLIS_PER_DAY = 86_400_000

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function marketClosedForToday(now = new Date()) {
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

function finiteNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sessionTimestamp(dateKey: string) {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const [, year, month, day] = match
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), 2, 0, 0) / 1000
  return Number.isFinite(timestamp) ? timestamp : null
}

function normalizeRows(raw: unknown): OhlcvBar[] {
  const data = (raw as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []

  const bars: OhlcvBar[] = []
  for (const rawRow of data) {
    const row = rawRow as Record<string, unknown>
    const time = sessionTimestamp(String(row.date ?? ""))
    const open = finiteNumber(row.adOpen ?? row.open)
    const high = finiteNumber(row.adHigh ?? row.high)
    const low = finiteNumber(row.adLow ?? row.low)
    const close = finiteNumber(row.adClose ?? row.close)
    const volume = finiteNumber(row.nmVolume ?? row.volume ?? 0)
    if (time == null || open == null || high == null || low == null || close == null || volume == null) continue
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) continue
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) continue
    bars.push({ time, open, high, low, close, volume })
  }

  const byTime = new Map<number, OhlcvBar>()
  for (const bar of bars) byTime.set(bar.time, bar)
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export function buildVnDirectDailyHistoryUrl(symbol: string, lookbackDays: number, now = new Date()) {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid VNDirect ticker: ${symbol}`)
  const safeLookbackDays = Math.max(1, Math.floor(lookbackDays))
  const from = vietnamDateKey(new Date(now.getTime() - safeLookbackDays * MILLIS_PER_DAY))
  const to = vietnamDateKey(now)
  const url = new URL(VNDIRECT_STOCK_PRICES_URL)
  url.searchParams.set("sort", "date")
  url.searchParams.set("q", `code:${ticker}~date:gte:${from}~date:lte:${to}`)
  url.searchParams.set("size", String(Math.min(VNDIRECT_MAX_ROWS, safeLookbackDays + 2)))
  url.searchParams.set("page", "1")
  return url.toString()
}

export async function fetchVnDirectDailyOhlcv(
  symbol: string,
  now = new Date(),
  lookbackDays: number,
): Promise<OhlcvBar[]> {
  const ticker = symbol.trim().toUpperCase()
  const url = buildVnDirectDailyHistoryUrl(ticker, lookbackDays, now)
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 QeoIndex/1.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(VNDIRECT_REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`VNDirect OHLC ${ticker} failed (${response.status}): ${text.slice(0, 180)}`)
  }

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`VNDirect OHLC ${ticker} returned invalid JSON`)
  }

  let bars = normalizeRows(payload)
  if (!marketClosedForToday(now)) {
    const today = vietnamDateKey(now)
    bars = bars.filter((bar) => vietnamDateKey(new Date(bar.time * 1000)) !== today)
  }
  if (!bars.length) throw new Error(`VNDirect OHLC ${ticker} returned no usable completed daily bars`)
  return bars
}
