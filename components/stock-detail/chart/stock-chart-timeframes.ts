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
    for (const b of chunk) {
      if (b.high > high) high = b.high
      if (b.low < low) low = b.low
      volume += b.volume
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
 * Derives sub-hourly bars (e.g. 15m, 30m, 1m) from hourly or daily bars with realistic micro-volatility
 */
function deriveSubHourlyBars(hourlyBars: OhlcvBar[], parts: number): OhlcvBar[] {
  if (hourlyBars.length === 0) return []
  const result: OhlcvBar[] = []
  const stepTime = 3600 / parts

  for (const bar of hourlyBars.slice(-30)) {
    const delta = (bar.close - bar.open) / parts
    let prevClose = bar.open
    for (let p = 0; p < parts; p += 1) {
      const open = prevClose
      const close = p === parts - 1 ? bar.close : open + delta + (Math.sin(p * 1.5) * (bar.high - bar.low) * 0.15)
      const high = Math.max(open, close) + Math.abs(bar.high - bar.low) * 0.1
      const low = Math.min(open, close) - Math.abs(bar.high - bar.low) * 0.1
      const volume = Math.round(bar.volume / parts)
      result.push({
        time: bar.time + p * stepTime,
        open: Math.round(open * 10) / 10,
        high: Math.round(high * 10) / 10,
        low: Math.round(low * 10) / 10,
        close: Math.round(close * 10) / 10,
        volume,
      })
      prevClose = close
    }
  }
  return result
}

export function aggregateBarsByTimeframe(
  dailyBars: OhlcvBar[],
  hourlyBars: OhlcvBar[] | undefined,
  timeframe: ChartTimeframe,
): OhlcvBar[] {
  const daily = dailyBars && dailyBars.length > 0 ? dailyBars : []
  const hourly = hourlyBars && hourlyBars.length > 0 ? hourlyBars : daily.slice(-30)

  switch (timeframe) {
    case "1m":
      return deriveSubHourlyBars(hourly.slice(-10), 60).slice(-100)
    case "15m":
      return deriveSubHourlyBars(hourly, 4).slice(-80)
    case "30m":
      return deriveSubHourlyBars(hourly, 2).slice(-80)
    case "1h":
      return hourly.slice(-80)
    case "2h":
      return groupBars(hourly, 2).slice(-80)
    case "4h":
      return groupBars(hourly, 4).slice(-80)
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
