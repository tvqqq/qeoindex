import "server-only"

import type { OhlcvBar } from "@/modules/shared/technical/indicators"

const TITANLABS_SERIES_URL = "https://www.titanlabs.vn/api/charts/series"
const DAY_SECONDS = 86_400
const MAX_LOOKBACK_DAYS = 50 * 366
const REQUEST_TIMEOUT_MS = 10_000
const DAILY_FINALIZATION_MINUTES_ICT = 15 * 60 + 15
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh"

type TitanLabsPayload = {
  s?: unknown
  symbol?: unknown
  count?: unknown
  firstDate?: unknown
  lastDate?: unknown
  t?: unknown
  o?: unknown
  h?: unknown
  l?: unknown
  c?: unknown
  v?: unknown
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function vietnamClock(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIETNAM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  const year = values.get("year") ?? ""
  const month = values.get("month") ?? ""
  const day = values.get("day") ?? ""
  const hour = Number(values.get("hour") ?? 0)
  const minute = Number(values.get("minute") ?? 0)
  return { dateKey: `${year}-${month}-${day}`, minutes: hour * 60 + minute }
}

function canonicalDailyTime(dateKey: string) {
  return Math.floor(new Date(`${dateKey}T02:00:00.000Z`).getTime() / 1000)
}

function validBar(bar: OhlcvBar) {
  return Number.isInteger(bar.time)
    && bar.time > 0
    && Number.isFinite(bar.open)
    && Number.isFinite(bar.high)
    && Number.isFinite(bar.low)
    && Number.isFinite(bar.close)
    && Number.isFinite(bar.volume)
    && bar.open > 0
    && bar.high > 0
    && bar.low > 0
    && bar.close > 0
    && bar.volume >= 0
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
}

export function buildTitanLabsDailyHistoryUrl(symbol: string) {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid TitanLabs ticker: ${symbol}`)
  const url = new URL(TITANLABS_SERIES_URL)
  url.searchParams.set("symbol", ticker)
  return url.toString()
}

export function parseTitanLabsDailyPayload(
  payload: unknown,
  input: { ticker: string; from: number; to: number; now: Date },
): OhlcvBar[] {
  if (!payload || typeof payload !== "object") return []
  const raw = payload as TitanLabsPayload
  if (raw.s != null && String(raw.s).toLowerCase() !== "ok") return []
  if (raw.symbol != null && String(raw.symbol).trim().toUpperCase() !== input.ticker) return []

  const times = Array.isArray(raw.t) ? raw.t : []
  const opens = Array.isArray(raw.o) ? raw.o : []
  const highs = Array.isArray(raw.h) ? raw.h : []
  const lows = Array.isArray(raw.l) ? raw.l : []
  const closes = Array.isArray(raw.c) ? raw.c : []
  const volumes = Array.isArray(raw.v) ? raw.v : []
  if (!times.length || [opens, highs, lows, closes, volumes].some((items) => items.length !== times.length)) return []

  const declaredCount = finite(raw.count)
  if (declaredCount != null && Math.trunc(declaredCount) !== times.length) return []

  const currentVietnam = vietnamClock(input.now)
  const currentSessionFinalized = currentVietnam.minutes >= DAILY_FINALIZATION_MINUTES_ICT
  const byTime = new Map<number, OhlcvBar>()

  for (let index = 0; index < times.length; index += 1) {
    const sourceTime = finite(times[index])
    const rawOpen = finite(opens[index])
    const rawHigh = finite(highs[index])
    const rawLow = finite(lows[index])
    const rawClose = finite(closes[index])
    const volume = finite(volumes[index])
    if (sourceTime == null || rawOpen == null || rawHigh == null || rawLow == null || rawClose == null || volume == null) continue

    const sessionDate = vietnamClock(new Date(Math.trunc(sourceTime) * 1000)).dateKey
    if (sessionDate === currentVietnam.dateKey && !currentSessionFinalized) continue

    const bar: OhlcvBar = {
      time: canonicalDailyTime(sessionDate),
      open: rawOpen / 1000,
      high: rawHigh / 1000,
      low: rawLow / 1000,
      close: rawClose / 1000,
      volume,
    }
    if (bar.time < input.from || bar.time > input.to || !validBar(bar)) continue
    byTime.set(bar.time, bar)
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export async function fetchTitanLabsDailyOhlcv(
  symbol: string,
  now = new Date(),
  lookbackDays = 620,
): Promise<OhlcvBar[]> {
  const ticker = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid TitanLabs ticker: ${symbol}`)
  if (!Number.isFinite(lookbackDays) || lookbackDays < 1 || lookbackDays > MAX_LOOKBACK_DAYS) {
    throw new Error("Invalid TitanLabs Daily lookback")
  }

  const to = Math.floor(now.getTime() / 1000)
  const from = to - Math.ceil(lookbackDays) * DAY_SECONDS
  const url = buildTitanLabsDailyHistoryUrl(ticker)
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 QeoIndex/1.0",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`TitanLabs Daily ${ticker} failed (${response.status}): ${text.slice(0, 180)}`)

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`TitanLabs Daily ${ticker} returned invalid JSON`)
  }

  const bars = parseTitanLabsDailyPayload(payload, { ticker, from, to, now })
  if (!bars.length) throw new Error(`TitanLabs Daily ${ticker} returned no usable completed bars`)
  return bars
}
