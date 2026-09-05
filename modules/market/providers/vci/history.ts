import "server-only"

import type { CanonicalOhlcvBar } from "../../chart-data/contract"

const VCI_OHLC_URL = "https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart"
const DAY_SECONDS = 86_400
const MAX_RANGE_SECONDS = 31 * DAY_SECONDS
const MAX_COUNT_BACK = 9_300
const MIN_COUNT_BACK = 300
const BARS_PER_CALENDAR_DAY_BUDGET = 300
const REQUEST_TIMEOUT_MS = 8_000

type VciVector = {
  symbol?: unknown
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

function validBar(bar: CanonicalOhlcvBar) {
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

function countBackForRange(from: number, to: number) {
  const calendarDays = Math.max(1, Math.ceil((to - from) / DAY_SECONDS))
  return Math.min(MAX_COUNT_BACK, Math.max(MIN_COUNT_BACK, calendarDays * BARS_PER_CALENDAR_DAY_BUDGET))
}

export function parseVciMinutePayload(
  payload: unknown,
  input: { ticker: string; from: number; to: number; nowSeconds: number },
): CanonicalOhlcvBar[] {
  const vectors = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const vector = vectors.find((item) => {
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

  const completedTo = Math.min(input.to, input.nowSeconds - 60)
  const byTime = new Map<number, CanonicalOhlcvBar>()
  for (let index = 0; index < times.length; index += 1) {
    const time = finite(times[index])
    const rawOpen = finite(opens[index])
    const rawHigh = finite(highs[index])
    const rawLow = finite(lows[index])
    const rawClose = finite(closes[index])
    const volume = finite(volumes[index])
    if (time == null || rawOpen == null || rawHigh == null || rawLow == null || rawClose == null || volume == null) continue

    const bar: CanonicalOhlcvBar = {
      time: Math.trunc(time),
      open: rawOpen / 1000,
      high: rawHigh / 1000,
      low: rawLow / 1000,
      close: rawClose / 1000,
      volume,
    }
    if (bar.time < input.from || bar.time > completedTo || !validBar(bar)) continue
    byTime.set(bar.time, bar)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export async function fetchVciMinuteOhlcvRange(
  tickerInput: string,
  from: number,
  to: number,
  now = new Date(),
): Promise<CanonicalOhlcvBar[]> {
  const ticker = tickerInput.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid VCI OHLC ticker")
  if (!Number.isInteger(from) || !Number.isInteger(to) || from <= 0 || to <= from) throw new Error("Invalid VCI 1m OHLC range")
  if (to - from > MAX_RANGE_SECONDS) throw new Error("VCI 1m OHLC range exceeds 31 days")

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
      timeFrame: "ONE_MINUTE",
      symbols: [ticker],
      to,
      countBack: countBackForRange(from, to),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`VCI OHLC request failed (${response.status})`)

  const payload = await response.json() as unknown
  const bars = parseVciMinutePayload(payload, {
    ticker,
    from,
    to,
    nowSeconds: Math.floor(now.getTime() / 1000),
  })
  if (!bars.length) throw new Error("VCI OHLC returned no completed 1m bars in requested range")
  return bars
}
