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


/**
 * Current-bar linear regression value over a fixed consecutive window.
 * This matches TradingView ta.linreg(src, length, 0) / TongDaXin FORCAST(src, length)
 * closely enough for deterministic chart use.
 */
export function calculateLinearRegression(
  values: Array<number | null>,
  period: number,
): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (!Number.isInteger(period) || period <= 1 || values.length < period) return result

  const xMean = (period - 1) / 2
  let denominator = 0
  for (let x = 0; x < period; x += 1) denominator += (x - xMean) ** 2
  if (denominator === 0) return result

  for (let i = period - 1; i < values.length; i += 1) {
    let sum = 0
    let valid = true
    for (let j = 0; j < period; j += 1) {
      const value = values[i - period + 1 + j]
      if (value == null || !Number.isFinite(value)) {
        valid = false
        break
      }
      sum += value
    }
    if (!valid) continue

    const yMean = sum / period
    let numerator = 0
    for (let j = 0; j < period; j += 1) {
      numerator += (j - xMean) * ((values[i - period + 1 + j] as number) - yMean)
    }
    const slope = numerator / denominator
    const intercept = yMean - slope * xMean
    result[i] = intercept + slope * (period - 1)
  }
  return result
}

/**
 * DE / 弘历背离王 reconstruction.
 *
 * Core:
 *   A1..A5 = FORCAST(EMA(close, 5/8/11/14/17), 6)
 *   B       = A1 + A2 + A3 + A4 - 4*A5
 *   TOWERC  = EMA(B, 2)
 * Ribbon:
 *   FORCAST(EMA(B, 3..17), 6)
 */
export function calculateDeSeries(bars: OhlcvBar[]) {
  const closes = bars.map((bar) => bar.close)
  const forecast = (period: number) => calculateLinearRegression(calculateEma(closes, period), 6)
  const [a1, a2, a3, a4, a5] = [5, 8, 11, 14, 17].map(forecast)
  const base: Array<number | null> = Array(bars.length).fill(null)

  for (let i = 0; i < bars.length; i += 1) {
    const values = [a1[i], a2[i], a3[i], a4[i], a5[i]]
    if (values.some((value) => value == null)) continue
    base[i] = (values[0] as number)
      + (values[1] as number)
      + (values[2] as number)
      + (values[3] as number)
      - 4 * (values[4] as number)
  }

  const tower = calculateEma(base, 2)
  const ribbon = Array.from({ length: 15 }, (_, offset) => {
    const period = offset + 3
    return calculateLinearRegression(calculateEma(base, period), 6)
  })

  return { base, tower, ribbon }
}

/**
 * Recursive XSA smoothing used by the public whale-pump formula family.
 * After an SMA seed, each point is:
 *   (src * weight + previous * (length - weight)) / length
 */
export function calculateXsa(
  values: Array<number | null>,
  length: number,
  weight = 1,
): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (!Number.isInteger(length) || length <= 0 || !Number.isFinite(weight) || weight <= 0 || weight > length) {
    return result
  }

  let previous: number | null = null
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]
    if (value == null || !Number.isFinite(value)) continue

    if (previous == null) {
      if (i < length - 1) continue
      let sum = 0
      let valid = true
      for (let j = i - length + 1; j <= i; j += 1) {
        const candidate = values[j]
        if (candidate == null || !Number.isFinite(candidate)) {
          valid = false
          break
        }
        sum += candidate
      }
      if (!valid) continue
      previous = sum / length
    } else {
      previous = (value * weight + previous * (length - weight)) / length
    }
    result[i] = previous
  }
  return result
}

function rollingExtreme(
  values: Array<number | null>,
  period: number,
  mode: "min" | "max",
): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null)
  if (!Number.isInteger(period) || period <= 0) return result

  for (let i = period - 1; i < values.length; i += 1) {
    let extreme = mode === "min" ? Infinity : -Infinity
    let valid = true
    for (let j = i - period + 1; j <= i; j += 1) {
      const value = values[j]
      if (value == null || !Number.isFinite(value)) {
        valid = false
        break
      }
      extreme = mode === "min" ? Math.min(extreme, value) : Math.max(extreme, value)
    }
    if (valid) result[i] = extreme
  }
  return result
}

/**
 * AM / Accumulate reconstruction from the public xrf/xsa whale-pump family.
 * The yellow signal intentionally uses the "rising only" variant:
 *   value > value[1] && value > 0
 *
 * This is a price-pressure detector near a 30-bar rolling low. It does not use
 * volume, order flow, open interest, or any privileged "whale" data.
 */
export function calculateAmSeries(bars: OhlcvBar[]) {
  const n = bars.length
  const lows = bars.map((bar) => bar.low)
  const absoluteLowMove: Array<number | null> = Array(n).fill(null)
  const positiveLowMove: Array<number | null> = Array(n).fill(null)

  for (let i = 1; i < n; i += 1) {
    const delta = lows[i] - lows[i - 1]
    absoluteLowMove[i] = Math.abs(delta)
    positiveLowMove[i] = Math.max(delta, 0)
  }

  const smoothedAbsolute = calculateXsa(absoluteLowMove, 3, 1)
  const smoothedPositive = calculateXsa(positiveLowMove, 3, 1)
  const pressureRatio: Array<number | null> = Array(n).fill(null)

  for (let i = 0; i < n; i += 1) {
    const numerator = smoothedAbsolute[i]
    const denominator = smoothedPositive[i]
    if (numerator == null || denominator == null) continue
    pressureRatio[i] = denominator === 0 ? 0 : (numerator / denominator) * 100
  }

  const pressure = calculateEma(
    pressureRatio.map((value) => value == null ? null : value * 10),
    3,
  )
  const rollingLow30 = rollingExtreme(lows, 30, "min")
  const maxPressure30 = rollingExtreme(pressure, 30, "max")
  const impulse: Array<number | null> = Array(n).fill(null)

  for (let i = 0; i < n; i += 1) {
    if (rollingLow30[i] == null || pressure[i] == null || maxPressure30[i] == null) continue
    impulse[i] = lows[i] <= (rollingLow30[i] as number)
      ? ((pressure[i] as number) + 2 * (maxPressure30[i] as number)) / 2
      : 0
  }

  const smoothedImpulse = calculateEma(impulse, 3)
  const value = smoothedImpulse.map((item) => item == null ? null : Math.min(item / 618, 100))
  const signal = value.map((item, index) => (
    item != null
    && item > 0
    && index > 0
    && value[index - 1] != null
    && item > (value[index - 1] as number)
  ))

  return { value, signal, pressure }
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
