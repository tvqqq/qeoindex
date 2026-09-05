import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import type { VolumeProfileBucket, VolumeProfileData } from "./stock-chart-types"

/**
 * Calculate Simple Moving Average (SMA) series
 */
export function calculateSma(bars: OhlcvBar[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(bars.length).fill(null)
  if (bars.length < period) return result
  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

/**
 * Calculate simple moving average for volume. Kept separate from price SMA so
 * callers never accidentally mix close-price and volume semantics.
 */
export function calculateVolumeSma(bars: OhlcvBar[], period = 20): Array<number | null> {
  const result: Array<number | null> = Array(bars.length).fill(null)
  if (bars.length < period || !Number.isInteger(period) || period <= 0) return result

  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].volume
    if (i >= period) sum -= bars[i - period].volume
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

/**
 * Calculate Exponential Moving Average (EMA) series
 */
export function calculateEma(values: (number | null)[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  const validIndices: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] != null) validIndices.push(i)
  }
  if (validIndices.length < period) return result

  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i += 1) {
    sum += values[validIndices[i]] as number
  }
  let currentEma = sum / period
  result[validIndices[period - 1]] = currentEma

  for (let i = period; i < validIndices.length; i += 1) {
    const val = values[validIndices[i]] as number
    currentEma = val * k + currentEma * (1 - k)
    result[validIndices[i]] = currentEma
  }
  return result
}

/**
 * Calculate Relative Strength Index (RSI) series over given period (default 14)
 * using Wilder's smoothed average gain/loss definition.
 */
export function calculateRsiSeries(bars: OhlcvBar[], period = 14): Array<number | null> {
  const result: Array<number | null> = Array(bars.length).fill(null)
  if (bars.length <= period) return result

  let avgGain = 0
  let avgLoss = 0

  for (let i = 1; i <= period; i += 1) {
    const diff = bars[i].close - bars[i - 1].close
    if (diff > 0) avgGain += diff
    else avgLoss -= diff
  }
  avgGain /= period
  avgLoss /= period

  if (avgLoss === 0) {
    result[period] = avgGain === 0 ? 50 : 100
  } else if (avgGain === 0) {
    result[period] = 0
  } else {
    const rs = avgGain / avgLoss
    result[period] = 100 - 100 / (1 + rs)
  }

  for (let i = period + 1; i < bars.length; i += 1) {
    const diff = bars[i].close - bars[i - 1].close
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    if (avgLoss === 0) {
      result[i] = avgGain === 0 ? 50 : 100
    } else if (avgGain === 0) {
      result[i] = 0
    } else {
      const currentRs = avgGain / avgLoss
      result[i] = 100 - 100 / (1 + currentRs)
    }
  }

  return result
}

/**
 * Calculate Moving Average Convergence Divergence (MACD 12, 26, 9)
 */
export function calculateMacdSeries(bars: OhlcvBar[]) {
  const closes = bars.map((b) => b.close)
  const ema12 = calculateEma(closes, 12)
  const ema26 = calculateEma(closes, 26)

  const macdLine: Array<number | null> = Array(bars.length).fill(null)
  for (let i = 0; i < bars.length; i += 1) {
    if (ema12[i] != null && ema26[i] != null) {
      macdLine[i] = (ema12[i] as number) - (ema26[i] as number)
    }
  }

  const signalLine = calculateEma(macdLine, 9)
  const histogram: Array<number | null> = Array(bars.length).fill(null)
  for (let i = 0; i < bars.length; i += 1) {
    if (macdLine[i] != null && signalLine[i] != null) {
      histogram[i] = (macdLine[i] as number) - (signalLine[i] as number)
    }
  }

  return { macd: macdLine, signal: signalLine, histogram }
}

export const ICHIMOKU_DISPLACEMENT = 26

/**
 * Calculate Ichimoku Kinko Hyo (9, 26, 52).
 * Senkou spans are displaced 26 bars forward and therefore intentionally
 * extend 26 logical slots beyond the last real candle. Tenkan/Kijun/Chikou
 * remain aligned to the real OHLCV input length.
 */
export function calculateIchimokuSeries(bars: OhlcvBar[]) {
  const n = bars.length
  const tenkan: Array<number | null> = Array(n).fill(null)
  const kijun: Array<number | null> = Array(n).fill(null)
  const spanA: Array<number | null> = Array(n + ICHIMOKU_DISPLACEMENT).fill(null)
  const spanB: Array<number | null> = Array(n + ICHIMOKU_DISPLACEMENT).fill(null)
  const chikou: Array<number | null> = Array(n).fill(null)

  const hlAvg = (startIdx: number, count: number) => {
    let high = -Infinity
    let low = Infinity
    for (let i = startIdx; i < startIdx + count; i += 1) {
      if (bars[i].high > high) high = bars[i].high
      if (bars[i].low < low) low = bars[i].low
    }
    return (high + low) / 2
  }

  for (let i = 8; i < n; i += 1) {
    tenkan[i] = hlAvg(i - 8, 9)
  }

  for (let i = 25; i < n; i += 1) {
    kijun[i] = hlAvg(i - 25, 26)
  }

  for (let i = 25; i < n; i += 1) {
    const target = i + ICHIMOKU_DISPLACEMENT
    if (tenkan[i] != null && kijun[i] != null) {
      spanA[target] = ((tenkan[i] as number) + (kijun[i] as number)) / 2
    }
  }

  for (let i = 51; i < n; i += 1) {
    const target = i + ICHIMOKU_DISPLACEMENT
    spanB[target] = hlAvg(i - 51, 52)
  }

  for (let i = 0; i < n - ICHIMOKU_DISPLACEMENT; i += 1) {
    chikou[i] = bars[i + ICHIMOKU_DISPLACEMENT].close
  }

  return { tenkan, kijun, spanA, spanB, chikou }
}

/**
 * Calculate an Ichimoku base/Kijun-style line over an arbitrary lookback.
 * QeoIndex uses period=129 as a proprietary cycle baseline with no displacement.
 */
export function calculateIchimokuBaseSeries(bars: OhlcvBar[], period = 129): Array<number | null> {
  const result: Array<number | null> = Array(bars.length).fill(null)
  if (!Number.isInteger(period) || period <= 0 || bars.length < period) return result

  for (let i = period - 1; i < bars.length; i += 1) {
    let highestHigh = -Infinity
    let lowestLow = Infinity
    for (let j = i - period + 1; j <= i; j += 1) {
      if (bars[j].high > highestHigh) highestHigh = bars[j].high
      if (bars[j].low < lowestLow) lowestLow = bars[j].low
    }
    result[i] = (highestHigh + lowestLow) / 2
  }

  return result
}

/**
 * Calculate Bollinger Bands (period 20, stdDev multiplier 2)
 */
export function calculateBollingerBands(bars: OhlcvBar[], period = 20, multiplier = 2) {
  const middle = calculateSma(bars, period)
  const upper: Array<number | null> = Array(bars.length).fill(null)
  const lower: Array<number | null> = Array(bars.length).fill(null)

  for (let i = period - 1; i < bars.length; i += 1) {
    const m = middle[i]
    if (m == null) continue
    let variance = 0
    for (let j = i - period + 1; j <= i; j += 1) {
      const diff = bars[j].close - m
      variance += diff * diff
    }
    const stdDev = Math.sqrt(variance / period)
    upper[i] = m + multiplier * stdDev
    lower[i] = m - multiplier * stdDev
  }

  return { middle, upper, lower }
}

/**
 * Calculate Volume Profile and Point of Control (POC) for the bars supplied by
 * the caller. The production chart passes only visibleBars, keeping the range
 * semantics explicit and excluding indicator warm-up history.
 */
export function calculateVolumeProfile(bars: OhlcvBar[], numBuckets = 20): VolumeProfileData {
  if (bars.length === 0) {
    return { buckets: [], pocPrice: 0, maxBucketVol: 0 }
  }

  let min = Infinity
  let max = -Infinity
  for (const b of bars) {
    if (b.low < min) min = b.low
    if (b.high > max) max = b.high
  }

  const range = max - min || 1
  const bucketSize = range / numBuckets
  const volBuckets = Array(numBuckets).fill(0)

  for (const b of bars) {
    const typicalPrice = (b.high + b.low + b.close) / 3
    const bucketIdx = Math.min(numBuckets - 1, Math.max(0, Math.floor((typicalPrice - min) / bucketSize)))
    volBuckets[bucketIdx] += b.volume
  }

  let maxVol = 0
  let pocIdx = 0
  for (let i = 0; i < numBuckets; i += 1) {
    if (volBuckets[i] > maxVol) {
      maxVol = volBuckets[i]
      pocIdx = i
    }
  }

  const pocPrice = min + (pocIdx + 0.5) * bucketSize

  const buckets: VolumeProfileBucket[] = volBuckets.map((vol, i) => ({
    price: min + (i + 0.5) * bucketSize,
    volume: vol,
    isPoc: i === pocIdx,
  }))

  return { buckets, pocPrice, maxBucketVol: maxVol }
}
