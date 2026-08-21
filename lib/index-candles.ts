export const INDEX_CHART_SYMBOLS = ["VNINDEX", "VN30F1M"] as const
export const INDEX_CHART_RESOLUTIONS = ["1", "5", "30", "1H", "4H", "1D"] as const

export type IndexChartSymbol = (typeof INDEX_CHART_SYMBOLS)[number]
export type IndexChartResolution = (typeof INDEX_CHART_RESOLUTIONS)[number]

export const INDEX_CHART_RESOLUTION_LABELS: Record<IndexChartResolution, string> = {
  "1": "1m",
  "5": "5m",
  "30": "30m",
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
}

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

const VIETNAM_TZ = "Asia/Ho_Chi_Minh"
const DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: VIETNAM_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

const RESOLUTION_MINUTES: Partial<Record<IndexChartResolution, number>> = {
  "1": 1,
  "5": 5,
  "30": 30,
  "1H": 60,
  "4H": 240,
}

const SESSION_ANCHOR_MINUTES: Record<IndexChartSymbol, number> = {
  VNINDEX: 9 * 60,
  VN30F1M: 8 * 60 + 45,
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

function vietnamTimeParts(timestampSeconds: number) {
  const parts = DATE_PARTS_FORMATTER.formatToParts(new Date(timestampSeconds * 1000))
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const year = read("year")
  const month = read("month")
  const day = read("day")
  const hour = read("hour") % 24
  const minute = read("minute")
  return {
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    minuteOfDay: hour * 60 + minute,
  }
}

export function isIndexChartSymbol(value: unknown): value is IndexChartSymbol {
  const normalized = String(value ?? "").trim().toUpperCase()
  return normalized === "VNINDEX" || normalized === "VN30F1M"
}

export function isIndexChartResolution(value: unknown): value is IndexChartResolution {
  return INDEX_CHART_RESOLUTIONS.includes(String(value ?? "").trim().toUpperCase() as IndexChartResolution)
}

export function isSessionSeparatorResolution(resolution: IndexChartResolution) {
  return resolution === "1" || resolution === "5" || resolution === "30" || resolution === "1H"
}

export function candleDateKey(time: number) {
  return vietnamTimeParts(time).dateKey
}

export function timeframeBucketKey(time: number, symbol: IndexChartSymbol, resolution: IndexChartResolution) {
  const { dateKey, minuteOfDay } = vietnamTimeParts(time)
  if (resolution === "1D") return dateKey
  const minutes = RESOLUTION_MINUTES[resolution] ?? 1
  const anchor = SESSION_ANCHOR_MINUTES[symbol]
  const bucket = Math.floor((minuteOfDay - anchor) / minutes)
  return `${dateKey}:${bucket}`
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
    timeZone: VIETNAM_TZ,
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

function mergeBucket(existing: CandleBar, incoming: CandleBar): CandleBar {
  return {
    time: existing.time,
    open: existing.open,
    high: Math.max(existing.high, incoming.high),
    low: Math.min(existing.low, incoming.low),
    close: incoming.close,
    // REST/native timeframe history is the authoritative volume baseline. Live 1m frames
    // improve price immediately; the 30s bootstrap refresh reconciles aggregate volume.
    volume: Math.max(existing.volume, incoming.volume),
  }
}

export function resampleCandleSeries(
  bars: CandleBar[],
  resolution: IndexChartResolution,
  symbol: IndexChartSymbol,
): CandleBar[] {
  if (resolution === "1") return [...bars].sort((a, b) => a.time - b.time)
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const result: CandleBar[] = []
  let activeKey = ""

  for (const bar of sorted) {
    const key = timeframeBucketKey(bar.time, symbol, resolution)
    const current = result[result.length - 1]
    if (!current || key !== activeKey) {
      result.push({ ...bar })
      activeKey = key
      continue
    }
    result[result.length - 1] = {
      time: current.time,
      open: current.open,
      high: Math.max(current.high, bar.high),
      low: Math.min(current.low, bar.low),
      close: bar.close,
      volume: current.volume + bar.volume,
    }
  }
  return result
}

export function mergeMinuteIntoTimeframeSeries(
  current: CandleBar[],
  minuteBar: CandleBar,
  resolution: IndexChartResolution,
  symbol: IndexChartSymbol,
  partialMinute = false,
): CandleBar[] {
  if (resolution === "1") return upsertCandleBar(current, minuteBar, partialMinute)
  const key = timeframeBucketKey(minuteBar.time, symbol, resolution)
  const index = current.findLastIndex((bar) => timeframeBucketKey(bar.time, symbol, resolution) === key)
  if (index < 0) return [...current, minuteBar].sort((a, b) => a.time - b.time)
  const next = current.slice()
  next[index] = mergeBucket(next[index], minuteBar)
  return next
}

export function mergeTimeframeSeries(
  base: CandleBar[],
  live: CandleBar[],
  resolution: IndexChartResolution,
  symbol: IndexChartSymbol,
  mergeLiveAsPartial = true,
): CandleBar[] {
  let next = [...base].sort((a, b) => a.time - b.time)
  for (const bar of [...live].sort((a, b) => a.time - b.time)) {
    const key = timeframeBucketKey(bar.time, symbol, resolution)
    const index = next.findLastIndex((candidate) => timeframeBucketKey(candidate.time, symbol, resolution) === key)
    if (index < 0) {
      next.push(bar)
      next.sort((a, b) => a.time - b.time)
      continue
    }
    const copy = next.slice()
    copy[index] = mergeLiveAsPartial ? mergeBucket(copy[index], bar) : bar
    next = copy
  }
  return next
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
