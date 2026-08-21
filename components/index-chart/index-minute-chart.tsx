"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { loadLightweightCharts, type LightweightChartApi, type LightweightSeriesApi } from "@/lib/lightweight-charts-runtime"
import {
  candleDateKey,
  isSessionSeparatorResolution,
  type CandleBar,
  type IndexChartResolution,
  type IndexChartSymbol,
} from "@/lib/index-candles"

const UP_COLOR = "#22c98a"
const DOWN_COLOR = "#ff4757"
const INITIAL_VISIBLE_BARS: Record<IndexChartResolution, number> = {
  "1": 420,
  "5": 300,
  "30": 220,
  "1H": 180,
  "4H": 160,
  "1D": 180,
}
const BAR_SPACING: Record<IndexChartResolution, number> = {
  "1": 7,
  "5": 7,
  "30": 8,
  "1H": 9,
  "4H": 10,
  "1D": 9,
}
const TIME_ONLY_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
})
const FULL_TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
})

function chartSeconds(time: unknown) {
  const seconds = typeof time === "number" ? time : Number(time)
  return Number.isFinite(seconds) ? seconds : null
}

export function formatIndexAxisTick(time: unknown, resolution: IndexChartResolution) {
  const seconds = chartSeconds(time)
  if (seconds === null) return ""
  const date = new Date(seconds * 1000)
  return resolution === "1D" ? DATE_ONLY_FORMATTER.format(date) : TIME_ONLY_FORMATTER.format(date)
}

function formatCrosshairTime(time: unknown, resolution: IndexChartResolution) {
  const seconds = chartSeconds(time)
  if (seconds === null) return ""
  const date = new Date(seconds * 1000)
  return resolution === "1D" ? FULL_DATE_FORMATTER.format(date) : FULL_TIME_FORMATTER.format(date)
}

export function dayStartTimes(data: CandleBar[]) {
  const result: number[] = []
  let previousDate = ""
  for (const bar of data) {
    const date = candleDateKey(bar.time)
    if (date !== previousDate) {
      result.push(bar.time)
      previousDate = date
    }
  }
  return result
}

function barSignature(bar?: CandleBar) {
  return bar ? `${bar.time}:${bar.open}:${bar.high}:${bar.low}:${bar.close}:${bar.volume}` : ""
}

function prefixSignature(data: CandleBar[]) {
  if (data.length <= 1) return ""
  const lastStableIndex = data.length - 2
  const middleIndex = Math.floor(lastStableIndex / 2)
  return [
    barSignature(data[0]),
    barSignature(data[middleIndex]),
    barSignature(data[lastStableIndex]),
  ].join("|")
}

function candleDatum(bar: CandleBar): Record<string, unknown> {
  return { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }
}

function volumeDatum(bar: CandleBar): Record<string, unknown> {
  return {
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(34,201,138,0.38)" : "rgba(255,71,87,0.38)",
  }
}

export function IndexMinuteChart({
  symbol,
  data,
  resolution,
}: {
  symbol: IndexChartSymbol
  data: CandleBar[]
  resolution: IndexChartResolution
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const markerLayerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<LightweightChartApi | null>(null)
  const candleSeriesRef = useRef<LightweightSeriesApi | null>(null)
  const volumeSeriesRef = useRef<LightweightSeriesApi | null>(null)
  const dataRef = useRef(data)
  const renderedRef = useRef<{ length: number; prefix: string; firstTime: number } | null>(null)
  const markerRafRef = useRef<number | null>(null)
  const [runtimeError, setRuntimeError] = useState("")

  const renderDayMarkers = useCallback(() => {
    const layer = markerLayerRef.current
    const chart = chartRef.current
    if (!layer || !chart) return
    layer.replaceChildren()
    if (!isSessionSeparatorResolution(resolution)) return

    const starts = dayStartTimes(dataRef.current)
    const timeScale = chart.timeScale()
    starts.forEach((time, index) => {
      const x = timeScale.timeToCoordinate(time)
      if (x === null || !Number.isFinite(x) || x < -60 || x > layer.clientWidth + 60) return

      if (index > 0) {
        const line = document.createElement("div")
        line.className = "absolute top-0 bottom-[26px] w-px bg-slate-400/[0.18]"
        line.style.left = `${Math.round(x)}px`
        layer.appendChild(line)
      }

      const label = document.createElement("span")
      label.className = "absolute bottom-[3px] -translate-x-1/2 rounded bg-[#080c10]/95 px-1 font-mono text-[9px] font-semibold text-slate-500"
      label.style.left = `${Math.round(x)}px`
      label.textContent = DATE_ONLY_FORMATTER.format(new Date(time * 1000))
      layer.appendChild(label)
    })
  }, [resolution])

  const scheduleDayMarkers = useCallback(() => {
    if (markerRafRef.current !== null) return
    markerRafRef.current = window.requestAnimationFrame(() => {
      markerRafRef.current = null
      renderDayMarkers()
    })
  }, [renderDayMarkers])

  const anchorLatest = useCallback((bars: CandleBar[]) => {
    const chart = chartRef.current
    if (!chart || !bars.length) return
    const visibleBars = INITIAL_VISIBLE_BARS[resolution]
    if (bars.length <= visibleBars) {
      chart.timeScale().fitContent()
      return
    }
    const last = bars.length - 1
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(-0.5, last - visibleBars + 1),
      to: last + 4,
    })
  }, [resolution])

  const syncData = useCallback((bars: CandleBar[], fit = false) => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    const chart = chartRef.current
    if (!candleSeries || !volumeSeries || !chart || !bars.length) return

    const previous = renderedRef.current
    const prefix = prefixSignature(bars)
    const firstTime = bars[0].time
    const canIncrementalUpdate = Boolean(
      previous &&
      previous.length === bars.length &&
      previous.prefix === prefix &&
      previous.firstTime === firstTime,
    )

    if (canIncrementalUpdate) {
      const last = bars[bars.length - 1]
      candleSeries.update(candleDatum(last))
      volumeSeries.update(volumeDatum(last))
    } else {
      candleSeries.setData(bars.map(candleDatum))
      volumeSeries.setData(bars.map(volumeDatum))
    }

    const historyExpandedBackwards = Boolean(
      previous &&
      firstTime < previous.firstTime &&
      bars.length > previous.length + 20,
    )
    renderedRef.current = { length: bars.length, prefix, firstTime }
    if (fit || !previous || historyExpandedBackwards) anchorLatest(bars)
    scheduleDayMarkers()
  }, [anchorLatest, scheduleDayMarkers])

  useEffect(() => {
    dataRef.current = data
    syncData(data)
  }, [data, syncData])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    let rangeHandler: ((range: { from: number; to: number } | null) => void) | null = null

    void (async () => {
      try {
        const lwc = await loadLightweightCharts()
        if (disposed || !containerRef.current) return
        const precision = symbol === "VN30F1M" ? 1 : 2
        const minMove = symbol === "VN30F1M" ? 0.1 : 0.01
        const chart = lwc.createChart(containerRef.current, {
          autoSize: true,
          layout: {
            attributionLogo: true,
            background: { type: lwc.ColorType.Solid, color: "#080c10" },
            textColor: "#94a3b8",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            panes: {
              separatorColor: "rgba(255,255,255,0.08)",
              separatorHoverColor: "rgba(34,201,138,0.28)",
              enableResize: true,
            },
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.028)" },
            horzLines: { color: "rgba(255,255,255,0.035)" },
          },
          rightPriceScale: {
            borderColor: "rgba(255,255,255,0.08)",
            scaleMargins: { top: 0.08, bottom: 0.08 },
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.08)",
            timeVisible: resolution !== "1D",
            secondsVisible: false,
            rightOffset: 4,
            barSpacing: BAR_SPACING[resolution],
            minBarSpacing: 2,
            tickMarkFormatter: (time: unknown) => formatIndexAxisTick(time, resolution),
          },
          localization: {
            locale: "vi-VN",
            timeFormatter: (time: unknown) => formatCrosshairTime(time, resolution),
          },
          crosshair: {
            vertLine: { color: "rgba(148,163,184,0.35)", labelBackgroundColor: "#334155" },
            horzLine: { color: "rgba(148,163,184,0.35)", labelBackgroundColor: "#334155" },
          },
          handleScroll: true,
          handleScale: true,
        })
        const candles = chart.addSeries(lwc.CandlestickSeries, {
          upColor: UP_COLOR,
          downColor: DOWN_COLOR,
          wickUpColor: UP_COLOR,
          wickDownColor: DOWN_COLOR,
          borderVisible: false,
          priceFormat: { type: "price", precision, minMove },
          priceLineVisible: true,
          lastValueVisible: true,
        }, 0)
        const volume = chart.addSeries(lwc.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceLineVisible: false,
          lastValueVisible: false,
        }, 1)
        chart.panes()[1]?.setHeight(92)
        chartRef.current = chart
        candleSeriesRef.current = candles
        volumeSeriesRef.current = volume
        setRuntimeError("")

        rangeHandler = () => scheduleDayMarkers()
        chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler)
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => scheduleDayMarkers())
          resizeObserver.observe(container)
        }
        syncData(dataRef.current, true)
      } catch (error) {
        if (!disposed) setRuntimeError(error instanceof Error ? error.message : "Không thể khởi tạo biểu đồ")
      }
    })()

    return () => {
      disposed = true
      if (markerRafRef.current !== null) {
        window.cancelAnimationFrame(markerRafRef.current)
        markerRafRef.current = null
      }
      resizeObserver?.disconnect()
      if (rangeHandler && chartRef.current) {
        chartRef.current.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
      }
      chartRef.current?.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      renderedRef.current = null
      markerLayerRef.current?.replaceChildren()
    }
  }, [symbol, resolution, scheduleDayMarkers, syncData])

  return (
    <div className="relative h-full min-h-[300px] w-full overflow-hidden rounded-b-2xl bg-[#080c10]">
      <div ref={containerRef} className="absolute inset-0" />
      <div ref={markerLayerRef} className="pointer-events-none absolute inset-0 z-[2] overflow-hidden" aria-hidden="true" />
      {runtimeError ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[#080c10]/95 p-6 text-center">
          <div className="max-w-sm rounded-xl border border-rose-500/25 bg-rose-500/5 px-4 py-3 text-xs leading-relaxed text-rose-300">
            {runtimeError}
          </div>
        </div>
      ) : null}
    </div>
  )
}
