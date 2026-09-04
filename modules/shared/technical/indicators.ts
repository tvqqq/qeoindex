export interface OhlcvBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface TechnicalSnapshot {
  price: number
  changePct: number
  volume: number
  ma20: number | null
  ma50: number | null
  ma200: number | null
  rsi14: number | null
  macd: number | null
  macdSignal: number | null
  atr14: number | null
  relVolume: number | null
}

function avg(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  return avg(values.slice(-period))
}

function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (values.length < period) return out
  const multiplier = 2 / (period + 1)
  let current = avg(values.slice(0, period))
  out[period - 1] = current
  for (let i = period; i < values.length; i += 1) {
    current = (values[i] - current) * multiplier + current
    out[i] = current
  }
  return out
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null
  let averageGain = 0
  let averageLoss = 0
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1]
    if (diff > 0) averageGain += diff
    else averageLoss -= diff
  }
  averageGain /= period
  averageLoss /= period
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1]
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)
    averageGain = (averageGain * (period - 1) + gain) / period
    averageLoss = (averageLoss * (period - 1) + loss) / period
  }
  if (averageLoss === 0) return 100
  const rs = averageGain / averageLoss
  return 100 - 100 / (1 + rs)
}

export function macd(values: number[]) {
  if (values.length < 35) return { macd: null, signal: null }
  const ema12 = emaSeries(values, 12)
  const ema26 = emaSeries(values, 26)
  const line = values.map((_, i) =>
    ema12[i] != null && ema26[i] != null ? (ema12[i] as number) - (ema26[i] as number) : null,
  )
  const validLine = line.filter((value): value is number => value != null)
  const signalSeries = emaSeries(validLine, 9)
  return {
    macd: validLine.at(-1) ?? null,
    signal: signalSeries.at(-1) ?? null,
  }
}

export function atr(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length <= period) return null
  const ranges: number[] = []
  for (let i = bars.length - period; i < bars.length; i += 1) {
    const bar = bars[i]
    const prevClose = bars[i - 1].close
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose)))
  }
  return avg(ranges)
}

export function relativeVolume(bars: OhlcvBar[], period = 20): number | null {
  if (bars.length <= period) return null
  const current = bars.at(-1)?.volume ?? 0
  const baseline = avg(bars.slice(-(period + 1), -1).map((bar) => bar.volume).filter((value) => value > 0))
  return baseline > 0 ? current / baseline : null
}

export function calculateTechnicalSnapshot(bars: OhlcvBar[]): TechnicalSnapshot {
  if (bars.length < 2) throw new Error("Need at least 2 OHLCV bars")
  const closes = bars.map((bar) => bar.close)
  const latest = bars.at(-1)!
  const previous = bars.at(-2)!
  const macdResult = macd(closes)
  return {
    price: latest.close,
    changePct: previous.close ? ((latest.close - previous.close) / previous.close) * 100 : 0,
    volume: latest.volume,
    ma20: sma(closes, 20),
    ma50: sma(closes, 50),
    ma200: sma(closes, 200),
    rsi14: rsi(closes, 14),
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    atr14: atr(bars, 14),
    relVolume: relativeVolume(bars, 20),
  }
}

export function aggregateWeekly(bars: OhlcvBar[]): OhlcvBar[] {
  const groups = new Map<string, OhlcvBar[]>()
  for (const bar of bars) {
    const date = new Date(bar.time * 1000)
    const day = (date.getUTCDay() + 6) % 7
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day))
    const key = monday.toISOString().slice(0, 10)
    const bucket = groups.get(key) ?? []
    bucket.push(bar)
    groups.set(key, bucket)
  }
  return [...groups.values()].map((bucket) => ({
    time: bucket[0].time,
    open: bucket[0].open,
    high: Math.max(...bucket.map((bar) => bar.high)),
    low: Math.min(...bucket.map((bar) => bar.low)),
    close: bucket.at(-1)!.close,
    volume: bucket.reduce((sum, bar) => sum + bar.volume, 0),
  }))
}
