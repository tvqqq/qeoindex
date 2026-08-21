export const INDEX_CHART_SYMBOLS = ["VNINDEX", "VN30F1M"] as const

export type IndexChartSymbol = (typeof INDEX_CHART_SYMBOLS)[number]

export interface CandleBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface DnseMarketFrame extends Record<string, unknown> {
  T?: unknown
  symbol?: unknown
  symbolType?: unknown
  indexName?: unknown
  time?: unknown
  transactTime?: unknown
  resolution?: unknown
}

export interface VnIndexAccumulatorState {
  bar: CandleBar | null
  minuteVolumeBase: number
  lastTotalVolume: number
}

export const EMPTY_VNINDEX_ACCUMULATOR: VnIndexAccumulatorState = {
  bar: null,
  minuteVolumeBase: 0,
  lastTotalVolume: 0,
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstPositive(data: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = finiteNumber(data[key])
    if (value !== null && value > 0) return value
  }
  return 0
}

export function isIndexChartSymbol(value: unknown): value is IndexChartSymbol {
  const normalized = String(value ?? "").trim().toUpperCase()
  return normalized === "VNINDEX" || normalized === "VN30F1M"
}

export function normalizeCandleBar(value: unknown): CandleBar | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const timeRaw = finiteNumber(row.time ?? row.t ?? row.timestamp ?? row.ts)
  const open = finiteNumber(row.open ?? row.o)
  const high = finiteNumber(row.high ?? row.h)
  const low = finiteNumber(row.low ?? row.l)
  const close = finiteNumber(row.close ?? row.c)
  const volume = finiteNumber(row.volume ?? row.v ?? row.vol) ?? 0
  if (timeRaw === null || open === null || high === null || low === null || close === null) return null
  const time = timeRaw > 10_000_000_000 ? Math.floor(timeRaw / 1000) : Math.floor(timeRaw)
  if (time <= 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0) return null
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null
  return { time, open, high, low, close, volume }
}

export function normalizeDnseOhlcFrame(frame: DnseMarketFrame): { symbol: IndexChartSymbol; bar: CandleBar } | null {
  const symbolType = String(frame.symbolType ?? "").trim().toUpperCase()
  const rawSymbol = String(frame.symbol ?? "").trim().toUpperCase()
  const symbolValue = isIndexChartSymbol(symbolType) ? symbolType : rawSymbol
  if (!isIndexChartSymbol(symbolValue)) return null
  const resolution = String(frame.resolution ?? "1").trim().toUpperCase()
  if (resolution !== "1" && resolution !== "1M") return null
  const bar = normalizeCandleBar(frame)
  return bar ? { symbol: symbolValue, bar } : null
}

function vietnamDateParts(timestampMs: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs))
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return { year: read("year"), month: read("month"), day: read("day") }
}

export function toEpochSeconds(value: unknown, nowMs = Date.now()): number {
  const direct = finiteNumber(value)
  if (direct !== null && direct > 0) return Math.floor(direct > 10_000_000_000 ? direct / 1000 : direct)
  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>
    const seconds = finiteNumber(data.Seconds ?? data.seconds)
    if (seconds !== null && seconds > 0) return Math.floor(seconds)
  }
  const text = String(value ?? "").trim()
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) {
    const [hour, minute, second] = text.split(":").map(Number)
    const { year, month, day } = vietnamDateParts(nowMs)
    return Math.floor(Date.UTC(year, month - 1, day, hour - 7, minute, second) / 1000)
  }
  if (text) {
    const millis = Date.parse(text)
    if (Number.isFinite(millis)) return Math.floor(millis / 1000)
  }
  return Math.floor(nowMs / 1000)
}

export function mergePartialCandle(existing: CandleBar, partial: CandleBar): CandleBar {
  if (existing.time !== partial.time) return partial
  return {
    time: existing.time,
    open: existing.open,
    high: Math.max(existing.high, partial.high),
    low: Math.min(existing.low, partial.low),
    close: partial.close,
    volume: Math.max(existing.volume, partial.volume),
  }
}

export function upsertCandleBar(current: CandleBar[], incoming: CandleBar, mergePartial = false): CandleBar[] {
  if (!current.length) return [incoming]
  const last = current[current.length - 1]
  if (incoming.time > last.time) return [...current, incoming]
  if (incoming.time === last.time) {
    const nextBar = mergePartial ? mergePartialCandle(last, incoming) : incoming
    return [...current.slice(0, -1), nextBar]
  }
  const index = current.findIndex((bar) => bar.time === incoming.time)
  if (index >= 0) {
    const next = current.slice()
    next[index] = mergePartial ? mergePartialCandle(next[index], incoming) : incoming
    return next
  }
  return [...current, incoming].sort((a, b) => a.time - b.time)
}

export function mergeCandleSeries(
  base: CandleBar[],
  live: CandleBar[],
  partialTimes: ReadonlySet<number> = new Set<number>(),
): CandleBar[] {
  const byTime = new Map<number, CandleBar>()
  for (const bar of base) byTime.set(bar.time, bar)
  for (const bar of live) {
    const existing = byTime.get(bar.time)
    byTime.set(bar.time, existing && partialTimes.has(bar.time) ? mergePartialCandle(existing, bar) : bar)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

export function accumulateVnindexFrame(
  state: VnIndexAccumulatorState,
  frame: DnseMarketFrame,
  nowMs = Date.now(),
): { state: VnIndexAccumulatorState; bar: CandleBar } | null {
  const name = String(frame.indexName ?? frame.symbol ?? "").trim().toUpperCase().replace(/[-_ ]/g, "")
  if (name !== "VNINDEX") return null
  const value = firstPositive(frame, ["valueIndexes", "value", "indexValue"])
  if (value <= 0) return null
  const timestamp = toEpochSeconds(frame.transactTime ?? frame.time ?? frame.timestamp ?? frame.ts, nowMs)
  const minute = Math.floor(timestamp / 60) * 60
  const totalVolume = firstPositive(frame, ["totalVolumeTraded", "totalVolume", "totalQtty", "allQtty", "vol", "v"])

  let bar: CandleBar
  let minuteVolumeBase = state.minuteVolumeBase
  if (!state.bar || state.bar.time !== minute) {
    const canUsePreviousTotal = totalVolume > 0 && state.lastTotalVolume > 0 && totalVolume >= state.lastTotalVolume
    minuteVolumeBase = canUsePreviousTotal ? state.lastTotalVolume : totalVolume
    bar = {
      time: minute,
      open: value,
      high: value,
      low: value,
      close: value,
      volume: canUsePreviousTotal ? Math.max(0, totalVolume - state.lastTotalVolume) : 0,
    }
  } else {
    const volume = totalVolume > 0 && totalVolume >= minuteVolumeBase
      ? Math.max(state.bar.volume, totalVolume - minuteVolumeBase)
      : state.bar.volume
    bar = {
      ...state.bar,
      high: Math.max(state.bar.high, value),
      low: Math.min(state.bar.low, value),
      close: value,
      volume,
    }
  }

  return {
    bar,
    state: {
      bar,
      minuteVolumeBase,
      lastTotalVolume: totalVolume > 0 ? totalVolume : state.lastTotalVolume,
    },
  }
}
