import "server-only"

import type { OhlcvBar } from "@/modules/shared/technical/indicators"

const VCI_OHLC_URL = "https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart"
const DAY_SECONDS = 86_400
const MAX_LOOKBACK_DAYS = 50 * 366
const MAX_COUNT_BACK = 15_000
const MIN_COUNT_BACK = 30
const REQUEST_TIMEOUT_MS = 8_000
const CANONICAL_DAILY_BAR_HOUR_UTC = 2
const DAILY_FINALIZATION_MINUTES_ICT = 15 * 60 + 15
const VIETNAM_TIME_ZONE = "Asia/Ho_Chi_Minh"

type VciVector = {
  symbol?: unknown
  t?: unknown
  o?: unknown
  h?: unknown
  l?: unknown
  c?: unknown
  v?: unknown
}

type VietnamClock = {
  dateKey: string
  minutes: number
}

function finite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function vietnamClock(date: Date): VietnamClock {
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
  return {
    dateKey: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
  }
}

function canonicalDailyTime(dateKey: string) {
  return Math.floor(new Date(`${dateKey}T${String(CANONICAL_DAILY_BAR_HOUR_UTC).padStart(2, "0")}:00:00.000Z`).getTime() / 1000)
}

function validBar(bar: OhlcvBar) {
  return Number.isInteger(bar.time)
    && bar.time > 0
    && bar.open > 0
    && bar.high > 0
    && bar.low > 0
    && bar.close > 0
    && bar.volume >= 0
    && bar.high >= Math.max(bar.open, bar.close, bar.low)
    && bar.low <= Math.min(bar.open, bar.close, bar.high)
}

function vectorsFromPayload(payload: unknown) {
  return Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
}

function dailyCountBack(lookbackDays: number) {
  return Math.min(MAX_COUNT_BACK, Math.max(MIN_COUNT_BACK, Math.ceil(lookbackDays) + 10))
}

export function parseVciDailyPayload(
  payload: unknown,
  input: { ticker: string; from: number; to: number; now: Date },
): OhlcvBar[] {
  const vector = vectorsFromPayload(payload).find((item) => {
    if (!item || typeof item !== "object") return false
    const symbol = String((item as VciVector).symbol ?? "").trim().toUpperCase()
    return !symbol || symbol === input.ticker
  }) as VciVector | undefined
  if (!vector) return []

  const times = Array.isArray(vector.t) ? vector.t : []
  const opens = Array.isArray(vector.o) ? vector.o : []
  const highs = Array.isArray(vector.h) ? vector.h : []
  const lows = Array.isArray(vector.l) ? vector.l : []
  const closes = Array.isArray(vector.c) ? vector.c : []
  const volumes = Array.isArray(vector.v) ? vector.v : []
  if (!times.length || [opens, highs, lows, closes, volumes].some((array) => array.length !== times.length)) return []

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

export async function fetchVciDailyOhlcv(
  tickerInput: string,
  now = new Date(),
  lookbackDays = 620,
): Promise<OhlcvBar[]> {
  const ticker = tickerInput.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid VCI Daily ticker")
  if (!Number.isFinite(lookbackDays) || lookbackDays < 1 || lookbackDays > MAX_LOOKBACK_DAYS) {
    throw new Error("Invalid VCI Daily lookback")
  }

  const to = Math.floor(now.getTime() / 1000)
  const from = to - Math.ceil(lookbackDays) * DAY_SECONDS
  const response = await fetch(VCI_OHLC_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Encoding": "identity",
      "Content-Type": "application/json",
      Origin: "https://trading.vietcap.com.vn",
      Referer: "https://trading.vietcap.com.vn/",
      "User-Agent": "Mozilla/5.0 QeoIndex/1.0",
    },
    body: JSON.stringify({
      timeFrame: "ONE_DAY",
      symbols: [ticker],
      to,
      countBack: dailyCountBack(lookbackDays),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`VCI Daily request failed (${response.status})`)

  const payload = await response.json() as unknown
  const bars = parseVciDailyPayload(payload, { ticker, from, to, now })
  if (!bars.length) throw new Error("VCI Daily returned no completed bars in requested range")
  return bars
}
