import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import type { ChartTimeframe } from "./stock-chart-types"

function groupBars(bars: OhlcvBar[], factor: number): OhlcvBar[] {
  if (factor <= 1 || bars.length === 0) return bars
  const result: OhlcvBar[] = []
  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor)
    if (chunk.length === 0) continue
    const open = chunk[0].open
    const close = chunk[chunk.length - 1].close
    let high = -Infinity
    let low = Infinity
    let volume = 0
    for (const bar of chunk) {
      if (bar.high > high) high = bar.high
      if (bar.low < low) low = bar.low
      volume += bar.volume
    }
    result.push({
      time: chunk[chunk.length - 1].time,
      open,
      high,
      low,
      close,
      volume,
    })
  }
  return result
}

function aggregateWeekly(bars: OhlcvBar[]): OhlcvBar[] {
  return groupBars(bars, 5)
}

function aggregateMonthly(bars: OhlcvBar[]): OhlcvBar[] {
  return groupBars(bars, 22)
}

function aggregateQuarterly(bars: OhlcvBar[]): OhlcvBar[] {
  return groupBars(bars, 66)
}

function aggregateYearly(bars: OhlcvBar[]): OhlcvBar[] {
  return groupBars(bars, 250)
}

/**
 * QEO-92 invariant: intraday candles are never synthesized from a coarser
 * resolution. QEO-93 will replace these temporary selectors with deterministic
 * session-aware aggregation from canonical 1m data.
 */
export function aggregateBarsByTimeframe(
  dailyBars: OhlcvBar[],
  hourlyBars: OhlcvBar[] | undefined,
  timeframe: ChartTimeframe,
): OhlcvBar[] {
  const daily = dailyBars && dailyBars.length > 0 ? dailyBars : []
  const hourly = hourlyBars && hourlyBars.length > 0 ? hourlyBars : []

  switch (timeframe) {
    case "1m":
    case "15m":
    case "30m":
      return []
    case "1h":
      return hourly.slice(-80)
    case "2h":
      return hourly.length ? groupBars(hourly, 2).slice(-80) : []
    case "4h":
      return hourly.length ? groupBars(hourly, 4).slice(-80) : []
    case "1D":
      return daily.slice(-90)
    case "3D":
      return groupBars(daily, 3).slice(-80)
    case "1W":
      return aggregateWeekly(daily).slice(-70)
    case "1M":
      return aggregateMonthly(daily).slice(-60)
    case "1Q":
      return aggregateQuarterly(daily).slice(-40)
    case "1Y":
      return aggregateYearly(daily).slice(-20)
    default:
      return daily.slice(-90)
  }
}
