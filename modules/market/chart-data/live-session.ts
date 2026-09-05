import type { CanonicalOhlcvBar } from "./contract"

export interface LiveMinutePartition {
  responseBars: CanonicalOhlcvBar[]
  completedBars: CanonicalOhlcvBar[]
  currentBar: CanonicalOhlcvBar | null
}

export function activeMinuteStart(nowSeconds: number) {
  return Math.floor(nowSeconds / 60) * 60
}

export function partitionLiveMinuteBars(
  bars: CanonicalOhlcvBar[],
  currentMinuteStart: number,
  isLiveSession: boolean,
): LiveMinutePartition {
  if (!isLiveSession) {
    return {
      responseBars: bars,
      completedBars: bars,
      currentBar: null,
    }
  }

  const responseBars = bars.filter((bar) => bar.time <= currentMinuteStart)
  const completedBars = responseBars.filter((bar) => bar.time < currentMinuteStart)
  const currentBar = responseBars.find((bar) => bar.time === currentMinuteStart) ?? null
  return { responseBars, completedBars, currentBar }
}
