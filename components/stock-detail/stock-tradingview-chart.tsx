"use client"

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toPng } from "html-to-image"
import {
  CalendarDays,
  Camera,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  loadLightweightCharts,
  type LightweightChartApi,
  type LightweightPriceLineApi,
  type LightweightSeriesApi,
} from "@/modules/shared/charts/lightweight-charts-runtime"
import { cn } from "@/modules/shared/ui/cn"
import { StockChartDrawingCanvas } from "./chart/stock-chart-drawing-canvas"
import { StockChartDrawingTools } from "./chart/stock-chart-drawing-tools"
import { StockChartIndicatorModal } from "./chart/stock-chart-indicator-modal"
import { StockChartObjectManager } from "./chart/stock-chart-object-manager"
import { StockChartTextEditor } from "./chart/stock-chart-text-editor"
import { boundChartTimeToTimeline, bridgeCoordinateToTime, bridgeTimeToCoordinate } from "./chart/chart-coordinate-bridge"
import {
  canonicalPaneGeometry,
  type MeasuredPaneGeometry,
  type PaneGeometry,
} from "./chart/chart-pane-geometry"
import { canIncrementallyUpdateLatest, fingerprintOhlcvPrefix } from "./chart/chart-render-diff"
import { chartTimeRangeForBars, shiftVisibleLogicalRange } from "./chart/chart-viewport"
import {
  calculateAmSeries,
  calculateBollingerBands,
  calculateDeSeries,
  calculateIchimokuBaseSeries,
  calculateIchimokuSeries,
  calculateMacdSeries,
  calculateRsiSeries,
  calculateSma,
  calculateVolumeProfile,
  calculateVolumeSma,
} from "./chart/stock-chart-indicators"
import { projectFutureTimes } from "./chart/future-timeline"
import { aggregateBarsByTimeframe } from "./chart/stock-chart-timeframes"
import {
  DEFAULT_INDICATOR_CONFIG,
  QUICK_TIMEFRAMES,
  type ChartTimeframe,
  type ChartViewSettings,
  type DrawingIconType,
  type DrawingTool,
  type VolumeProfileData,
} from "./chart/stock-chart-types"
import { useUserChartSync } from "./chart/use-user-chart-sync"

interface StockTradingViewChartProps {
  ticker: string
  bars: OhlcvBar[]
  hourlyBars?: OhlcvBar[]
  isLoading?: boolean
  isMaximized?: boolean
  onToggleMaximize?: () => void
  currentPrice?: number
  changePct?: number
  navigationTimeframe?: ChartTimeframe | null
  onPaneGeometryChange?: (geometry: MeasuredPaneGeometry) => void
}

const DEFAULT_RIGHT_OFFSET_BARS = 8
const MIN_MAX_RIGHT_OFFSET_BARS = 32
const INITIAL_MAX_VISIBLE_BARS = 180

type ChartDimensions = { width: number; height: number }

type RenderedData = {
  actualLength: number
  firstTime: number
  latestTime: number
  futureLength: number
  fingerprint: string
}

type ChartSeries = {
  candles: LightweightSeriesApi
  futureAxis: LightweightSeriesApi
  volume: LightweightSeriesApi
  volumeMa: LightweightSeriesApi
  ma20: LightweightSeriesApi
  ma50: LightweightSeriesApi
  ma200: LightweightSeriesApi
  bollingerUpper: LightweightSeriesApi
  bollingerMiddle: LightweightSeriesApi
  bollingerLower: LightweightSeriesApi
  ichimokuTenkan: LightweightSeriesApi
  ichimokuKijun: LightweightSeriesApi
  ichimokuSpanA: LightweightSeriesApi
  ichimokuSpanB: LightweightSeriesApi
  ichimokuChikou: LightweightSeriesApi
  qeoBase129: LightweightSeriesApi
  rsi: LightweightSeriesApi
  macd: LightweightSeriesApi
  macdSignal: LightweightSeriesApi
  macdHistogram: LightweightSeriesApi
  macdZero: LightweightSeriesApi
  rsiUpper: LightweightSeriesApi
  rsiMiddle: LightweightSeriesApi
  rsiLower: LightweightSeriesApi
  deTower: LightweightSeriesApi
  deRibbon: LightweightSeriesApi[]
  deZero: LightweightSeriesApi
  amBars: LightweightSeriesApi
  amZero: LightweightSeriesApi
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function toEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const businessDay = asRecord(value)
  if (!businessDay) return null
  const year = businessDay.year
  const month = businessDay.month
  const day = businessDay.day
  if (
    typeof year !== "number" || !Number.isInteger(year)
    || typeof month !== "number" || !Number.isInteger(month)
    || typeof day !== "number" || !Number.isInteger(day)
  ) return null
  return Math.floor(Date.UTC(year, month - 1, day) / 1000)
}

function formatAxisTime(value: unknown, timeframe: ChartTimeframe): string {
  const seconds = toEpochSeconds(value)
  if (seconds == null) return ""
  const date = new Date(seconds * 1000)
  if (timeframe.includes("m") || timeframe.includes("h")) {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)
  }
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
  }).format(date)
}

function formatCrosshairTime(value: unknown, timeframe: ChartTimeframe): string {
  const seconds = toEpochSeconds(value)
  if (seconds == null) return ""
  const date = new Date(seconds * 1000)
  if (timeframe.includes("m") || timeframe.includes("h")) {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date)
  }
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date)
}

function formatCompactVolume(volume: number | null | undefined) {
  if (typeof volume !== "number" || !Number.isFinite(volume)) return "—"
  if (Math.abs(volume) >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`
  if (Math.abs(volume) >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`
  if (Math.abs(volume) >= 1_000) return `${(volume / 1_000).toFixed(1)}K`
  return Math.round(volume).toLocaleString("vi-VN")
}

function normalizeBars(bars: OhlcvBar[]): OhlcvBar[] {
  const byTime = new Map<number, OhlcvBar>()
  for (const bar of bars) {
    if (!Number.isFinite(bar.time)) continue
    byTime.set(bar.time, bar)
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time)
}

function candleData(bars: OhlcvBar[]): Record<string, unknown>[] {
  return bars.map((bar) => ({
    time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }))
}

function futureAxisData(futureTimes: number[]): Record<string, unknown>[] {
  // Whitespace keeps future timestamps addressable without synthetic OHLC.
  return futureTimes.map((time) => ({ time }))
}

function rgbaFromHex(hex: string, opacity: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!match) return hex
  const value = Number.parseInt(match[1], 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red},${green},${blue},${Math.min(1, Math.max(0.1, opacity))})`
}

function lineStyleValue(style: "solid" | "dashed" | "dotted"): number {
  return style === "dotted" ? 1 : style === "dashed" ? 2 : 0
}

function applyIndicatorStyle(
  series: LightweightSeriesApi,
  style: { color: string; opacity: number; width: number; lineStyle: "solid" | "dashed" | "dotted" },
  visible: boolean,
) {
  series.applyOptions({
    color: rgbaFromHex(style.color, style.opacity),
    lineWidth: style.width,
    lineStyle: lineStyleValue(style.lineStyle),
    visible,
  })
}

function volumeData(bars: OhlcvBar[], opacity = 0.42): Record<string, unknown>[] {
  return bars.map((bar) => ({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open
      ? `rgba(34,201,138,${Math.min(1, Math.max(0.1, opacity))})`
      : `rgba(255,71,87,${Math.min(1, Math.max(0.1, opacity))})`,
  }))
}

function lineData(values: Array<number | null>, times: number[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (let index = 0; index < values.length && index < times.length; index += 1) {
    const value = values[index]
    if (typeof value !== "number" || !Number.isFinite(value)) continue
    result.push({ time: times[index], value })
  }
  return result
}

function constantLineData(value: number, times: number[]): Record<string, unknown>[] {
  return times.map((time) => ({ time, value }))
}

function histogramData(
  values: Array<number | null>,
  times: number[],
  opacity = 1,
): Record<string, unknown>[] {
  const maxAbs = Math.max(0.000001, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).map(Math.abs))
  return values.flatMap((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value) || index >= times.length) return []
    const intensity = 0.35 + (Math.abs(value) / maxAbs) * 0.65
    const alpha = Math.min(1, Math.max(0.1, opacity * intensity))
    return [{
      time: times[index],
      value,
      color: value >= 0 ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`,
    }]
  })
}

function deTowerData(values: Array<number | null>, times: number[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (let index = 1; index < values.length && index < times.length; index += 1) {
    const current = values[index]
    const previous = values[index - 1]
    if (
      typeof current !== "number" || !Number.isFinite(current)
      || typeof previous !== "number" || !Number.isFinite(previous)
    ) continue
    const rising = current >= previous
    const color = rising ? "#22c55e" : "#ff4757"
    result.push({
      time: times[index],
      open: previous,
      high: Math.max(previous, current),
      low: Math.min(previous, current),
      close: current,
      color,
      wickColor: color,
      borderColor: color,
    })
  }
  return result
}

function amSignalData(
  values: Array<number | null>,
  signals: boolean[],
  times: number[],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (let index = 0; index < values.length && index < times.length; index += 1) {
    const value = values[index]
    if (!signals[index] || typeof value !== "number" || !Number.isFinite(value)) continue
    result.push({
      time: times[index],
      open: 0,
      high: value,
      low: 0,
      close: value,
      color: "#fde047",
      wickColor: "#fde047",
      borderColor: "#fde047",
    })
  }
  return result
}

function chartSeriesOptions(visible: boolean, color: string, lineWidth = 1): Record<string, unknown> {
  return {
    color,
    lineWidth,
    visible,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  }
}

function findBarAtTime(bars: OhlcvBar[], time: number | null): OhlcvBar | null {
  if (time == null) return null
  return bars.find((bar) => bar.time === time) ?? null
}

function valueAtTime(values: Array<number | null>, times: number[], time: number | null): number | null {
  if (time == null) return null
  const index = times.indexOf(time)
  const value = index >= 0 ? values[index] : null
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatMetric(value: number | null, digits = 2): string {
  return value == null ? "—" : value.toFixed(digits)
}

interface AlignedIndicatorCanvasProps {
  width: number
  height: number
  clipHeight: number
  revision: number
  times: number[]
  spanA: Array<number | null>
  spanB: Array<number | null>
  volumeProfile: VolumeProfileData | null
  timeToX: (time: number) => number | null
  priceToY: (price: number) => number | null
  rsiPaneTop: number
  rsiPriceToY: (value: number) => number | null
  showRsiBand: boolean
  priceAxisGutter: number
}

/**
 * Lightweight Charts owns the market plot and all axes. This canvas is only
 * for indicator fills that the pinned runtime cannot express as a built-in
 * series: the Ichimoku cloud and a bounded, price-aligned volume profile.
 */
function AlignedIndicatorCanvas({
  width,
  height,
  clipHeight,
  revision,
  times,
  spanA,
  spanB,
  volumeProfile,
  timeToX,
  priceToY,
  rsiPaneTop,
  rsiPriceToY,
  showRsiBand,
  priceAxisGutter,
}: AlignedIndicatorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return
    const ratio = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`

    const context = canvas.getContext("2d")
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.save()

    if (showRsiBand) {
      const rsi70 = rsiPriceToY(70)
      const rsi30 = rsiPriceToY(30)
      if (rsi70 != null && rsi30 != null) {
        const top = rsiPaneTop + Math.min(rsi70, rsi30)
        const bandHeight = Math.max(1, Math.abs(rsi30 - rsi70))
        context.fillStyle = "rgba(182,160,248,0.08)"
        context.fillRect(0, top, Math.max(0, width - priceAxisGutter), bandHeight)
      }
    }

    context.beginPath()
    context.rect(0, 0, width, Math.max(0, Math.min(height, clipHeight)))
    context.clip()

    if (volumeProfile && volumeProfile.maxBucketVol > 0 && volumeProfile.buckets.length > 0) {
      const centers = volumeProfile.buckets.map((bucket) => bucket.price)
      const step = centers.length > 1
        ? Math.abs(centers[1] - centers[0])
        : Math.max(Math.abs(centers[0]) * 0.01, 0.01)
      const profileRight = Math.max(0, width - priceAxisGutter)
      const maxWidth = Math.min(180, Math.max(56, profileRight * 0.24))
      for (const bucket of volumeProfile.buckets) {
        const topCoordinate = priceToY(bucket.price + step / 2)
        const bottomCoordinate = priceToY(bucket.price - step / 2)
        if (topCoordinate == null || bottomCoordinate == null) continue
        const top = Math.min(topCoordinate, bottomCoordinate)
        const bucketHeight = Math.max(1, Math.abs(bottomCoordinate - topCoordinate) - 1)
        const widthRatio = Math.max(0, Math.min(1, bucket.volume / volumeProfile.maxBucketVol))
        const barWidth = Math.max(1, maxWidth * widthRatio)
        context.fillStyle = bucket.isPoc ? "rgba(245,158,11,0.54)" : "rgba(245,158,11,0.22)"
        context.fillRect(Math.max(0, profileRight - barWidth - 4), top, barWidth, bucketHeight)
      }
      const pocY = priceToY(volumeProfile.pocPrice)
      if (pocY != null) {
        context.strokeStyle = "rgba(245,158,11,0.92)"
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(Math.max(0, profileRight - maxWidth - 4), pocY)
        context.lineTo(profileRight, pocY)
        context.stroke()
        context.fillStyle = "rgba(254,215,170,0.95)"
        context.font = "10px ui-monospace, monospace"
        context.fillText(`POC ${volumeProfile.pocPrice.toFixed(2)}`, Math.max(2, profileRight - maxWidth), Math.max(11, pocY - 3))
      }
    }

    const spanLength = Math.min(times.length, spanA.length, spanB.length)
    for (let index = 1; index < spanLength; index += 1) {
      const previousA = spanA[index - 1]
      const previousB = spanB[index - 1]
      const currentA = spanA[index]
      const currentB = spanB[index]
      if (
        typeof previousA !== "number" || !Number.isFinite(previousA)
        || typeof previousB !== "number" || !Number.isFinite(previousB)
        || typeof currentA !== "number" || !Number.isFinite(currentA)
        || typeof currentB !== "number" || !Number.isFinite(currentB)
      ) continue
      const previousX = timeToX(times[index - 1])
      const currentX = timeToX(times[index])
      const previousAY = priceToY(previousA)
      const previousBY = priceToY(previousB)
      const currentAY = priceToY(currentA)
      const currentBY = priceToY(currentB)
      if (
        previousX == null || currentX == null
        || previousAY == null || previousBY == null
        || currentAY == null || currentBY == null
      ) continue
      context.beginPath()
      context.moveTo(previousX, previousAY)
      context.lineTo(currentX, currentAY)
      context.lineTo(currentX, currentBY)
      context.lineTo(previousX, previousBY)
      context.closePath()
      context.fillStyle = (previousA + currentA) / 2 >= (previousB + currentB) / 2
        ? "rgba(34,197,94,0.10)"
        : "rgba(239,68,68,0.10)"
      context.fill()
    }
    context.restore()
  }, [clipHeight, height, priceAxisGutter, priceToY, revision, rsiPaneTop, rsiPriceToY, showRsiBand, spanA, spanB, timeToX, times, volumeProfile, width])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2]"
      data-chart-indicator-overlay="aligned"
      data-chart-price-axis-gutter={priceAxisGutter}
    />
  )
}

export function StockTradingViewChart({
  ticker,
  bars,
  hourlyBars,
  isLoading = false,
  isMaximized = false,
  onToggleMaximize,
  currentPrice,
  changePct,
  navigationTimeframe,
  onPaneGeometryChange,
}: StockTradingViewChartProps) {
  const {
    timeframe,
    setTimeframe,
    indicators,
    setIndicators,
    viewSettings,
    setViewSettings,
    drawings,
    addDrawing,
    modifyDrawing,
    deleteDrawing,
    clearAllDrawings,
    saveStatus,
    drawingSyncStatus,
    retryChartHydration,
  } = useUserChartSync({
    ticker,
    preferredTimeframe: navigationTimeframe,
    defaultTimeframe: "1D",
    defaultChartStyle: "candles",
    defaultIndicators: DEFAULT_INDICATOR_CONFIG,
  })

  // Compact mode is a read-only market summary. It deliberately derives a
  // display-only indicator set and never writes the user's fullscreen choices.
  const effectiveIndicators = useMemo(() => isMaximized
    ? indicators
    : {
        ...indicators,
        showMa: true,
        showRsi: false,
        showMacd: false,
        showIchimoku: false,
        showBollinger: false,
        showVolumeProfile: false,
        showQeoBase129: false,
        showDe: false,
        showAm: false,
      }, [indicators, isMaximized])

  const displayBars = useMemo(
    () => normalizeBars(aggregateBarsByTimeframe(bars, hourlyBars, timeframe)),
    [bars, hourlyBars, timeframe],
  )
  const futureCount = Math.max(
    MIN_MAX_RIGHT_OFFSET_BARS,
    Math.ceil(Math.max(1, displayBars.length) * 0.5),
  )
  const futureTimes = useMemo(() => {
    const lastTime = displayBars.at(-1)?.time
    return lastTime == null ? [] : projectFutureTimes(lastTime, timeframe, futureCount)
  }, [displayBars, futureCount, timeframe])
  const allTimes = useMemo(
    () => [...displayBars.map((bar) => bar.time), ...futureTimes],
    [displayBars, futureTimes],
  )
  const barTimes = useMemo(() => displayBars.map((bar) => bar.time), [displayBars])
  const barFingerprint = useMemo(() => fingerprintOhlcvPrefix(displayBars), [displayBars])

  const ma20 = useMemo(() => calculateSma(displayBars, 20), [displayBars])
  const ma50 = useMemo(() => calculateSma(displayBars, 50), [displayBars])
  const ma200 = useMemo(() => calculateSma(displayBars, 200), [displayBars])
  const volumeMa20 = useMemo(() => calculateVolumeSma(displayBars, 20), [displayBars])
  const bollinger = useMemo(
    () => effectiveIndicators.showBollinger ? calculateBollingerBands(displayBars, 20, 2) : null,
    [displayBars, effectiveIndicators.showBollinger],
  )
  const ichimoku = useMemo(
    () => effectiveIndicators.showIchimoku ? calculateIchimokuSeries(displayBars) : null,
    [displayBars, effectiveIndicators.showIchimoku],
  )
  const qeoBase129 = useMemo(
    () => effectiveIndicators.showQeoBase129 ? calculateIchimokuBaseSeries(displayBars, 129) : [],
    [displayBars, effectiveIndicators.showQeoBase129],
  )
  const rsi = useMemo(
    () => isMaximized ? calculateRsiSeries(displayBars, 14) : [],
    [displayBars, isMaximized],
  )
  const macd = useMemo(
    () => isMaximized ? calculateMacdSeries(displayBars) : null,
    [displayBars, isMaximized],
  )
  const de = useMemo(
    () => isMaximized && effectiveIndicators.showDe ? calculateDeSeries(displayBars) : null,
    [displayBars, effectiveIndicators.showDe, isMaximized],
  )
  const am = useMemo(
    () => isMaximized && effectiveIndicators.showAm ? calculateAmSeries(displayBars) : null,
    [displayBars, effectiveIndicators.showAm, isMaximized],
  )

  const renderPayload = useMemo(() => ({
    candle: candleData(displayBars),
    futureAxis: futureAxisData(futureTimes),
    volume: volumeData(displayBars, viewSettings.indicatorStyles.volume.opacity),
    volumeMa: lineData(volumeMa20, barTimes),
    ma20: lineData(ma20, barTimes),
    ma50: lineData(ma50, barTimes),
    ma200: lineData(ma200, barTimes),
    bollingerUpper: lineData(bollinger?.upper ?? [], barTimes),
    bollingerMiddle: lineData(bollinger?.middle ?? [], barTimes),
    bollingerLower: lineData(bollinger?.lower ?? [], barTimes),
    ichimokuTenkan: lineData(ichimoku?.tenkan ?? [], barTimes),
    ichimokuKijun: lineData(ichimoku?.kijun ?? [], barTimes),
    ichimokuSpanA: lineData(ichimoku?.spanA ?? [], allTimes),
    ichimokuSpanB: lineData(ichimoku?.spanB ?? [], allTimes),
    ichimokuChikou: lineData(ichimoku?.chikou ?? [], barTimes),
    qeoBase129: lineData(qeoBase129, barTimes),
    rsi: lineData(rsi, barTimes),
    rsiUpper: constantLineData(70, barTimes),
    rsiMiddle: constantLineData(50, barTimes),
    rsiLower: constantLineData(30, barTimes),
    macd: lineData(macd?.macd ?? [], barTimes),
    macdSignal: lineData(macd?.signal ?? [], barTimes),
    macdHistogram: histogramData(macd?.histogram ?? [], barTimes, viewSettings.indicatorStyles.macd.opacity),
    macdZero: constantLineData(0, barTimes),
    deTower: deTowerData(de?.tower ?? [], barTimes),
    deRibbon: (de?.ribbon ?? []).map((series) => lineData(series, barTimes)),
    deZero: de ? constantLineData(0, barTimes) : [],
    amBars: amSignalData(am?.value ?? [], am?.signal ?? [], barTimes),
    amZero: am ? constantLineData(0, barTimes) : [],
  }), [
    allTimes,
    am,
    barTimes,
    bollinger,
    de,
    displayBars,
    futureTimes,
    ichimoku,
    ma20,
    ma50,
    ma200,
    macd,
    qeoBase129,
    rsi,
    volumeMa20,
    viewSettings,
  ])

  const plotContainerRef = useRef<HTMLDivElement>(null)
  const chartHostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<LightweightChartApi | null>(null)
  const seriesRef = useRef<ChartSeries | null>(null)
  const chartGenerationRef = useRef(0)
  const pocPriceLineRef = useRef<LightweightPriceLineApi | null>(null)
  const renderedRef = useRef<RenderedData | null>(null)
  const renderedTimeframeRef = useRef<ChartTimeframe | null>(null)
  const timeframeRef = useRef(timeframe)
  const visibleRangeRef = useRef<{ from: number; to: number } | null>(null)
  const overlayFrameRef = useRef<number | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<ChartDimensions>({ width: 0, height: 0 })
  const [visibleRangeState, setVisibleRangeState] = useState<{ from: number; to: number } | null>(null)
  const [overlayRevision, setOverlayRevision] = useState(0)
  const [latestCandleX, setLatestCandleX] = useState<number | null>(null)
  const [priceAxisGutter, setPriceAxisGutter] = useState(80)
  const [crosshairTime, setCrosshairTime] = useState<number | null>(null)
  const [showIndicatorModal, setShowIndicatorModal] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor")
  const [activeColor, setActiveColor] = useState("#00f0ff")
  const [lineWidth, setLineWidth] = useState(2)
  const [selectedIconType, setSelectedIconType] = useState<DrawingIconType>("flag")
  const [isDrawingsLocked, setIsDrawingsLocked] = useState(false)
  const [isDrawingsHidden, setIsDrawingsHidden] = useState(false)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [isObjectManagerOpen, setIsObjectManagerOpen] = useState(false)
  const [editingTextDrawingId, setEditingTextDrawingId] = useState<string | null>(null)
  const [isRsiCollapsed, setIsRsiCollapsed] = useState(false)
  const [isMacdCollapsed, setIsMacdCollapsed] = useState(false)
  const [measuredPaneGeometry, setMeasuredPaneGeometry] = useState<{
    key: string
    geometry: PaneGeometry
  } | null>(null)

  useEffect(() => {
    timeframeRef.current = timeframe
  }, [timeframe])

  useEffect(() => {
    if (drawingSyncStatus !== "ready") return
    setIsRsiCollapsed(viewSettings.rsiCollapsed)
    setIsMacdCollapsed(viewSettings.macdCollapsed)
  }, [drawingSyncStatus, viewSettings.macdCollapsed, viewSettings.rsiCollapsed])

  const scheduleOverlayPaint = useCallback(() => {
    if (typeof window === "undefined" || overlayFrameRef.current !== null) return
    overlayFrameRef.current = window.requestAnimationFrame(() => {
      overlayFrameRef.current = null
      setOverlayRevision((revision) => revision + 1)
    })
  }, [])

  const isHovering = crosshairTime !== null
  const activeBar = isHovering
    ? findBarAtTime(displayBars, crosshairTime)
    : displayBars.at(-1) ?? null
  const legendTime = crosshairTime ?? activeBar?.time ?? null
  const legendValues = {
    ma20: valueAtTime(ma20, barTimes, legendTime),
    ma50: valueAtTime(ma50, barTimes, legendTime),
    ma200: valueAtTime(ma200, barTimes, legendTime),
    bollingerUpper: valueAtTime(bollinger?.upper ?? [], barTimes, legendTime),
    bollingerMiddle: valueAtTime(bollinger?.middle ?? [], barTimes, legendTime),
    bollingerLower: valueAtTime(bollinger?.lower ?? [], barTimes, legendTime),
    ichimokuKijun: valueAtTime(ichimoku?.kijun ?? [], barTimes, legendTime),
    qeoBase129: valueAtTime(qeoBase129, barTimes, legendTime),
    rsi: valueAtTime(rsi, barTimes, legendTime),
    macd: valueAtTime(macd?.macd ?? [], barTimes, legendTime),
    macdSignal: valueAtTime(macd?.signal ?? [], barTimes, legendTime),
    macdHistogram: valueAtTime(macd?.histogram ?? [], barTimes, legendTime),
    de: valueAtTime(de?.tower ?? [], barTimes, legendTime),
    am: valueAtTime(am?.value ?? [], barTimes, legendTime),
  }
  const overlayWidth = dimensions.width || 1000
  const overlayHeight = dimensions.height || (isMaximized ? 640 : 340)
  const deVisible = Boolean(isMaximized && effectiveIndicators.showDe)
  const amVisible = Boolean(isMaximized && effectiveIndicators.showAm)
  const paneHeights = useMemo(() => canonicalPaneGeometry({
    hostHeight: overlayHeight,
    isMaximized: Boolean(isMaximized),
    rsiCollapsed: isRsiCollapsed,
    macdCollapsed: isMacdCollapsed,
    deVisible,
    amVisible,
  }), [amVisible, deVisible, isMacdCollapsed, isMaximized, isRsiCollapsed, overlayHeight])
  const paneGeometryKey = `${overlayHeight}:${isMaximized}:${isRsiCollapsed}:${isMacdCollapsed}:${deVisible}:${amVisible}`
  const effectivePaneHeights = measuredPaneGeometry?.key === paneGeometryKey
    ? measuredPaneGeometry.geometry
    : paneHeights
  const mainPaneHeight = effectivePaneHeights.main
  const drawingWidth = Math.max(0, overlayWidth - priceAxisGutter)
  useEffect(() => {
    if (!chartReady) return
    const measured = chartRef.current?.panes()[0]?.getRightPriceScale?.().width?.()
    if (typeof measured === "number" && measured > 0) setPriceAxisGutter(measured)
  }, [chartReady, dimensions.width, overlayRevision])

  // LWC owns the scales. Drawings are the only SVG overlay and always derive
  // their screen coordinates from current LWC series/time-scale coordinates.
  const priceToY = useCallback((price: number) => {
    return seriesRef.current?.candles.priceToCoordinate?.(price) ?? null
  }, [])
  const yToPrice = useCallback((y: number) => {
    return seriesRef.current?.candles.coordinateToPrice?.(y) ?? null
  }, [])
  const rsiPriceToY = useCallback((value: number) => {
    return seriesRef.current?.rsi.priceToCoordinate?.(value) ?? null
  }, [])
  const timeToX = useCallback((time: number) => {
    return bridgeTimeToCoordinate(
      time,
      allTimes,
      (candidate) => chartRef.current?.timeScale().timeToCoordinate(candidate) ?? null,
    )
  }, [allTimes])
  const xToTime = useCallback((x: number) => {
    const value = chartRef.current?.timeScale().coordinateToTime?.(x)
    const native = toEpochSeconds(value)
    if (native != null) return boundChartTimeToTimeline(native, allTimes)
    return bridgeCoordinateToTime(
      x,
      allTimes,
      (candidate) => chartRef.current?.timeScale().timeToCoordinate(candidate) ?? null,
    )
  }, [allTimes])
  useEffect(() => {
    const latestTime = displayBars.at(-1)?.time
    const frame = window.requestAnimationFrame(() => {
      setLatestCandleX(latestTime == null || !chartReady ? null : timeToX(latestTime))
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chartReady, displayBars, overlayRevision, timeToX])

  const volumeProfile = useMemo(() => {
    if (!effectiveIndicators.showVolumeProfile || displayBars.length === 0) return null
    const range = visibleRangeState
    if (!range) return calculateVolumeProfile(displayBars, 20)
    const from = Math.max(0, Math.floor(range.from))
    const to = Math.min(displayBars.length, Math.ceil(range.to) + 1)
    return calculateVolumeProfile(displayBars.slice(from, Math.max(from, to)), 20)
  }, [displayBars, effectiveIndicators.showVolumeProfile, visibleRangeState])

  useEffect(() => {
    const candles = seriesRef.current?.candles
    if (!candles) return
    if (pocPriceLineRef.current) candles.removePriceLine?.(pocPriceLineRef.current)
    pocPriceLineRef.current = null
    if (!volumeProfile || !isMaximized) return
    pocPriceLineRef.current = candles.createPriceLine?.({
      price: volumeProfile.pocPrice,
      color: "rgba(245,158,11,0.92)",
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: "POC",
    }) ?? null
    return () => {
      if (pocPriceLineRef.current) candles.removePriceLine?.(pocPriceLineRef.current)
      pocPriceLineRef.current = null
    }
  }, [chartReady, isMaximized, volumeProfile])

  const setLatestVisibleRange = useCallback(() => {
    const chart = chartRef.current
    if (!chart || displayBars.length === 0) return
    const visibleBars = Math.min(
      displayBars.length,
      Math.max(30, Math.min(INITIAL_MAX_VISIBLE_BARS, Math.round(displayBars.length * 0.75))),
    )
    // Future whitespace provides the addressable projection horizon. Keep the
    // initial/reset viewport anchored at the product default instead of
    // forcing half of the first view to be empty.
    const rightOffset = DEFAULT_RIGHT_OFFSET_BARS
    chart.applyOptions({ timeScale: { rightOffset } })
    const range = chartTimeRangeForBars(displayBars, futureTimes, visibleBars, rightOffset)
    if (range) chart.timeScale().setVisibleRange(range)
  }, [displayBars, futureTimes])

  const setVisibleBars = useCallback((count: number) => {
    const chart = chartRef.current
    if (!chart || displayBars.length === 0) return
    const visible = Math.min(displayBars.length, Math.max(15, count))
    const rightOffset = DEFAULT_RIGHT_OFFSET_BARS
    chart.applyOptions({ timeScale: { rightOffset } })
    const range = chartTimeRangeForBars(displayBars, futureTimes, visible, rightOffset)
    if (range) chart.timeScale().setVisibleRange(range)
  }, [displayBars, futureTimes])

  const handleResetView = useCallback(() => {
    setLatestVisibleRange()
    chartRef.current?.applyOptions({ rightPriceScale: { autoScale: true } })
  }, [setLatestVisibleRange])

  const handleExport = useCallback(async () => {
    const target = plotContainerRef.current
    if (!target) return
    setExportStatus("Đang tạo ảnh…")
    try {
      const dataUrl = await toPng(target, {
        cacheBust: true,
        backgroundColor: "#080b10",
        pixelRatio: 2,
      })
      const link = document.createElement("a")
      link.download = `${ticker.toUpperCase()}-${timeframe}-chart.png`
      link.href = dataUrl
      link.click()
      setExportStatus("Đã xuất ảnh")
    } catch {
      setExportStatus("Không thể xuất ảnh")
    }
    window.setTimeout(() => setExportStatus(null), 1800)
  }, [ticker, timeframe])

  // A ticker generation owns one LWC instance. Timeframe-only changes reuse
  // the instance and update formatting/data in place. Cleanup still invalidates
  // the generation before a slow CDN promise can resolve.
  useEffect(() => {
    const host = chartHostRef.current
    if (!host) return
    const generation = ++chartGenerationRef.current
    let disposed = false
    let chart: LightweightChartApi | null = null
    let resizeObserver: ResizeObserver | null = null
    let rangeHandler: ((range: { from: number; to: number } | null) => void) | null = null
    let crosshairHandler: ((param: unknown) => void) | null = null

    setChartReady(false)
    setRuntimeError(null)
    renderedRef.current = null
    renderedTimeframeRef.current = null
    visibleRangeRef.current = null
    seriesRef.current = null

    void loadLightweightCharts()
      .then((runtime) => {
        if (disposed || chartGenerationRef.current !== generation || !host.isConnected) return

        const initialTimeframe = timeframeRef.current
        chart = runtime.createChart(host, {
          width: Math.max(1, host.clientWidth),
          height: Math.max(1, host.clientHeight),
          layout: {
            attributionLogo: true,
            background: { type: runtime.ColorType.Solid, color: "#080b10" },
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
            visible: true,
            ticksVisible: true,
            borderColor: "rgba(255,255,255,0.08)",
            scaleMargins: { top: 0.08, bottom: 0.12 },
          },
          timeScale: {
            borderColor: "rgba(255,255,255,0.08)",
            timeVisible: initialTimeframe.includes("m") || initialTimeframe.includes("h"),
            secondsVisible: false,
            rightOffset: DEFAULT_RIGHT_OFFSET_BARS,
            barSpacing: 7,
            minBarSpacing: 2,
            tickMarkFormatter: (time: unknown) => formatAxisTime(time, initialTimeframe),
          },
          localization: {
            locale: "vi-VN",
            timeFormatter: (time: unknown) => formatCrosshairTime(time, initialTimeframe),
          },
          crosshair: {
            vertLine: { color: "rgba(148,163,184,0.42)", labelBackgroundColor: "#334155" },
            horzLine: { color: "rgba(148,163,184,0.42)", labelBackgroundColor: "#334155" },
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          },
          handleScale: {
            mouseWheel: true,
            pinch: true,
            axisPressedMouseMove: { time: true, price: true },
          },
        })

        const candles = chart.addSeries(runtime.CandlestickSeries, {
          upColor: "#22c98a",
          downColor: "#ff4757",
          wickUpColor: "#22c98a",
          wickDownColor: "#ff4757",
          borderUpColor: "#22c98a",
          borderDownColor: "#ff4757",
          borderVisible: false,
          priceLineVisible: true,
          lastValueVisible: true,
        }, 0)
        const volume = chart.addSeries(runtime.HistogramSeries, {
          priceFormat: { type: "volume" },
          priceScaleId: "right",
          priceLineVisible: false,
          lastValueVisible: false,
        }, 1)
        const volumeMa = chart.addSeries(runtime.LineSeries, {
          ...chartSeriesOptions(true, "#f59e0b", 1),
          title: "Volume MA20",
        }, 1)
        const addMainLine = (color: string, width = 1) => chart!.addSeries(
          runtime.LineSeries,
          chartSeriesOptions(false, color, width),
          0,
        )
        const series: ChartSeries = {
          candles,
          futureAxis: chart.addSeries(runtime.LineSeries, {
            color: "rgba(0,0,0,0)",
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
          }, 0),
          volume,
          volumeMa,
          ma20: addMainLine("#f8fafc"),
          ma50: addMainLine("#8b5cf6", 2),
          ma200: addMainLine("#f97316", 2),
          bollingerUpper: addMainLine("#38bdf8"),
          bollingerMiddle: addMainLine("#0ea5e9"),
          bollingerLower: addMainLine("#38bdf8"),
          ichimokuTenkan: addMainLine("#ef4444"),
          ichimokuKijun: addMainLine("#f59e0b"),
          ichimokuSpanA: addMainLine("#22c55e"),
          ichimokuSpanB: addMainLine("#ef4444"),
          ichimokuChikou: addMainLine("#94a3b8"),
          qeoBase129: addMainLine("#ec4899", 2),
          rsi: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#b6a0f8", 2),
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            lastValueVisible: true,
            priceLineVisible: false,
            title: "RSI 14",
          }, 2),
          rsiUpper: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#94a3b8", 1),
            priceScaleId: "right",
            lineStyle: 2,
            title: "RSI 70",
          }, 2),
          rsiMiddle: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#94a3b8", 1),
            priceScaleId: "right",
            lineStyle: 2,
            title: "RSI 50",
          }, 2),
          rsiLower: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#94a3b8", 1),
            priceScaleId: "right",
            lineStyle: 2,
            title: "RSI 30",
          }, 2),
          macd: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#2196f3", 1),
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
            title: "MACD",
            lastValueVisible: true,
          }, 3),
          macdSignal: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#f97316", 1),
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
            title: "Signal",
            lastValueVisible: true,
          }, 3),
          macdHistogram: chart.addSeries(runtime.HistogramSeries, {
            visible: false,
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
            priceLineVisible: false,
            lastValueVisible: true,
          }, 3),
          macdZero: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#64748b", 1),
            priceScaleId: "right",
            lineStyle: 2,
            title: "MACD 0",
          }, 3),
          deTower: chart.addSeries(runtime.CandlestickSeries, {
            visible: false,
            upColor: "#22c55e",
            downColor: "#ff4757",
            wickUpColor: "#22c55e",
            wickDownColor: "#ff4757",
            borderVisible: false,
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceLineVisible: false,
            lastValueVisible: true,
            title: "DE",
          }, 4),
          deRibbon: Array.from({ length: 15 }, () => chart!.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "rgba(248,250,252,0.88)", 1),
            priceScaleId: "right",
            lineVisible: false,
            pointMarkersVisible: true,
            pointMarkersRadius: 1.35,
          }, 4)),
          deZero: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#64748b", 1),
            priceScaleId: "right",
            lineStyle: 2,
            title: "DE 0",
          }, 4),
          amBars: chart.addSeries(runtime.CandlestickSeries, {
            visible: false,
            upColor: "#fde047",
            downColor: "#fde047",
            wickUpColor: "#fde047",
            wickDownColor: "#fde047",
            borderUpColor: "#fde047",
            borderDownColor: "#fde047",
            borderVisible: false,
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            priceLineVisible: false,
            lastValueVisible: true,
            title: "AM",
          }, 5),
          amZero: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#64748b", 1),
            priceScaleId: "right",
            lineStyle: 2,
            title: "AM 0",
          }, 5),
        }
        chartRef.current = chart
        seriesRef.current = series

        rangeHandler = (range) => {
          if (range) {
            visibleRangeRef.current = range
            setVisibleRangeState(range)
          }
          scheduleOverlayPaint()
        }
        chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler)
        crosshairHandler = (param) => {
          const payload = asRecord(param)
          setCrosshairTime(toEpochSeconds(payload?.time))
          // Price-axis drags do not necessarily emit a logical-range event;
          // repaint the coordinate overlay on the same pointer frame so the
          // cloud and profile follow the native price scale during zoom.
          scheduleOverlayPaint()
        }
        chart.subscribeCrosshairMove?.(crosshairHandler)

        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(() => {
            const width = host.clientWidth
            const height = host.clientHeight
            if (width > 0 && height > 0) {
              chart?.resize?.(width, height, true)
              setDimensions((current) => current.width === width && current.height === height
                ? current
                : { width, height })
              scheduleOverlayPaint()
            }
          })
          resizeObserver.observe(host)
        }
        const width = host.clientWidth
        const height = host.clientHeight
        if (width > 0 && height > 0) setDimensions({ width, height })
        setChartReady(true)
      })
      .catch((cause: unknown) => {
        if (!disposed && chartGenerationRef.current === generation) {
          setRuntimeError(cause instanceof Error ? cause.message : "Không thể khởi tạo biểu đồ")
        }
      })

    return () => {
      disposed = true
      chartGenerationRef.current += 1
      resizeObserver?.disconnect()
      if (rangeHandler && chart) chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
      if (crosshairHandler && chart) chart.unsubscribeCrosshairMove?.(crosshairHandler)
      chart?.remove()
      if (overlayFrameRef.current !== null) {
        window.cancelAnimationFrame(overlayFrameRef.current)
        overlayFrameRef.current = null
      }
      chart = null
      chartRef.current = null
      seriesRef.current = null
      renderedRef.current = null
      renderedTimeframeRef.current = null
      visibleRangeRef.current = null
      setChartReady(false)
    }
  }, [scheduleOverlayPaint, ticker])

  // Keep timeframe-specific axis formatting in sync while reusing the ticker-owned chart instance.
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return
    chart.applyOptions({
      timeScale: {
        timeVisible: timeframe.includes("m") || timeframe.includes("h"),
        tickMarkFormatter: (time: unknown) => formatAxisTime(time, timeframe),
      },
      localization: {
        locale: "vi-VN",
        timeFormatter: (time: unknown) => formatCrosshairTime(time, timeframe),
      },
    })
  }, [chartReady, timeframe])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !chartReady) return

    const styles = viewSettings.indicatorStyles
    applyIndicatorStyle(series.ma20, styles.ma, effectiveIndicators.showMa)
    applyIndicatorStyle(series.ma50, styles.ma, isMaximized && effectiveIndicators.showMa)
    applyIndicatorStyle(series.ma200, styles.ma, isMaximized && effectiveIndicators.showMa)
    applyIndicatorStyle(series.volumeMa, styles.volume, isMaximized)
    applyIndicatorStyle(series.bollingerUpper, styles.bollinger, effectiveIndicators.showBollinger)
    applyIndicatorStyle(series.bollingerMiddle, styles.bollinger, effectiveIndicators.showBollinger)
    applyIndicatorStyle(series.bollingerLower, styles.bollinger, effectiveIndicators.showBollinger)
    applyIndicatorStyle(series.ichimokuTenkan, styles.ichimoku, effectiveIndicators.showIchimoku)
    applyIndicatorStyle(series.ichimokuKijun, styles.ichimoku, effectiveIndicators.showIchimoku)
    applyIndicatorStyle(series.ichimokuSpanA, styles.ichimoku, effectiveIndicators.showIchimoku)
    applyIndicatorStyle(series.ichimokuSpanB, styles.ichimoku, effectiveIndicators.showIchimoku)
    applyIndicatorStyle(series.ichimokuChikou, styles.ichimoku, effectiveIndicators.showIchimoku)
    applyIndicatorStyle(series.qeoBase129, styles.qeoBase129, Boolean(effectiveIndicators.showQeoBase129))
    applyIndicatorStyle(series.rsi, styles.rsi, isMaximized && effectiveIndicators.showRsi)
    const rsiVisible = isMaximized && effectiveIndicators.showRsi
    applyIndicatorStyle(series.rsiUpper, { color: "#94a3b8", width: 1, opacity: 0.48, lineStyle: "dashed" }, rsiVisible)
    applyIndicatorStyle(series.rsiMiddle, { color: "#94a3b8", width: 1, opacity: 0.34, lineStyle: "dashed" }, rsiVisible)
    applyIndicatorStyle(series.rsiLower, { color: "#94a3b8", width: 1, opacity: 0.48, lineStyle: "dashed" }, rsiVisible)
    applyIndicatorStyle(series.macd, styles.macd, isMaximized && effectiveIndicators.showMacd)
    applyIndicatorStyle(series.macdSignal, { ...styles.macd, color: "#f97316" }, isMaximized && effectiveIndicators.showMacd)
    applyIndicatorStyle(series.macdHistogram, styles.macd, isMaximized && effectiveIndicators.showMacd)
    applyIndicatorStyle(series.macdZero, { ...styles.macd, color: "#64748b", width: 1, opacity: 0.65, lineStyle: "dashed" }, isMaximized && effectiveIndicators.showMacd)
    series.deTower.applyOptions({ visible: deVisible })
    for (const ribbonSeries of series.deRibbon) ribbonSeries.applyOptions({ visible: deVisible })
    series.deZero.applyOptions({ visible: deVisible })
    series.amBars.applyOptions({ visible: amVisible })
    series.amZero.applyOptions({ visible: amVisible })

    const previousTimeframe = renderedTimeframeRef.current
    const timeframeChanged = previousTimeframe !== timeframe
    if (timeframeChanged) {
      renderedRef.current = null
      visibleRangeRef.current = null
      renderedTimeframeRef.current = timeframe
    }

    const previous = renderedRef.current
    // setData can emit range changes while the series are being replaced.
    // Capture the user's viewport before those events overwrite the range ref.
    const rangeBeforeData = previous
      ? chart.timeScale().getVisibleLogicalRange() ?? visibleRangeRef.current
      : null
    const latest = displayBars.at(-1)
    const canUpdateLatest = canIncrementallyUpdateLatest(previous, displayBars)
      && previous?.futureLength === futureTimes.length

    if (displayBars.length === 0) {
      series.candles.setData([])
      series.volume.setData([])
      renderedRef.current = null
    } else if (canUpdateLatest) {
      const last = displayBars.at(-1)!
      series.candles.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close })
      const latestVolume = renderPayload.volume.at(-1)
      if (latestVolume) series.volume.update(latestVolume)
    } else {
      series.candles.setData(renderPayload.candle)
      series.volume.setData(renderPayload.volume)
    }

    series.volumeMa.setData(renderPayload.volumeMa)
    series.ma20.setData(renderPayload.ma20)
    series.ma50.setData(renderPayload.ma50)
    series.ma200.setData(renderPayload.ma200)
    series.bollingerUpper.setData(renderPayload.bollingerUpper)
    series.bollingerMiddle.setData(renderPayload.bollingerMiddle)
    series.bollingerLower.setData(renderPayload.bollingerLower)
    series.ichimokuTenkan.setData(renderPayload.ichimokuTenkan)
    series.ichimokuKijun.setData(renderPayload.ichimokuKijun)
    series.ichimokuSpanA.setData(renderPayload.ichimokuSpanA)
    series.ichimokuSpanB.setData(renderPayload.ichimokuSpanB)
    series.ichimokuChikou.setData(renderPayload.ichimokuChikou)
    series.qeoBase129.setData(renderPayload.qeoBase129)
    series.rsi.setData(renderPayload.rsi)
    series.rsiUpper.setData(renderPayload.rsiUpper)
    series.rsiMiddle.setData(renderPayload.rsiMiddle)
    series.rsiLower.setData(renderPayload.rsiLower)
    series.macd.setData(renderPayload.macd)
    series.macdSignal.setData(renderPayload.macdSignal)
    series.macdHistogram.setData(renderPayload.macdHistogram)
    series.macdZero.setData(renderPayload.macdZero)
    series.deTower.setData(renderPayload.deTower)
    for (let index = 0; index < series.deRibbon.length; index += 1) {
      series.deRibbon[index].setData(renderPayload.deRibbon[index] ?? [])
    }
    series.deZero.setData(renderPayload.deZero)
    series.amBars.setData(renderPayload.amBars)
    series.amZero.setData(renderPayload.amZero)
    // Apply future whitespace last. On a reused chart instance this keeps the
    // real dataset authoritative before the projection horizon is extended.
    series.futureAxis.setData(renderPayload.futureAxis)

    if (displayBars.length > 0 && !previous) {
      setLatestVisibleRange()
    } else if (previous && rangeBeforeData && displayBars[0]?.time < previous.firstTime) {
      // Prepending older history shifts logical indexes. Preserve the user's
      // current viewport instead of fitting the chart on every refresh.
      const prependedBars = displayBars.findIndex((bar) => bar.time === previous.firstTime)
      if (prependedBars > 0) {
        const range = shiftVisibleLogicalRange(rangeBeforeData, prependedBars)
        chart.timeScale().setVisibleLogicalRange(range)
        visibleRangeRef.current = range
        setVisibleRangeState(range)
      }
    }

    if (latest) {
      renderedRef.current = {
        actualLength: displayBars.length,
        firstTime: displayBars[0].time,
        latestTime: latest.time,
        futureLength: futureTimes.length,
        fingerprint: barFingerprint,
      }
    }
    scheduleOverlayPaint()
  }, [
    amVisible,
    chartReady,
    deVisible,
    displayBars,
    barFingerprint,
    futureTimes.length,
    indicators,
    effectiveIndicators,
    isMaximized,
    renderPayload,
    scheduleOverlayPaint,
    setLatestVisibleRange,
    timeframe,
    viewSettings,
  ])

  useLayoutEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return
    const panes = chart.panes()
    panes[1]?.setHeight(paneHeights.volume)
    panes[2]?.setHeight(paneHeights.rsi)
    panes[3]?.setHeight(paneHeights.macd)
    panes[4]?.setHeight(paneHeights.de)
    panes[5]?.setHeight(paneHeights.am)
    // Main is applied last so native pane redistribution cannot steal height
    // from the already-budgeted indicator panes.
    panes[0]?.setHeight(paneHeights.main)
    panes[1]?.getRightPriceScale?.().applyOptions({
      visible: true,
      ticksVisible: true,
      borderVisible: true,
    })
    panes[2]?.getRightPriceScale?.().applyOptions({
      visible: isMaximized,
      ticksVisible: isMaximized,
      borderVisible: isMaximized,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    })
    panes[3]?.getRightPriceScale?.().applyOptions({
      visible: isMaximized,
      ticksVisible: isMaximized,
      borderVisible: isMaximized,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    })
    panes[4]?.getRightPriceScale?.().applyOptions({
      visible: deVisible,
      ticksVisible: deVisible,
      borderVisible: deVisible,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    })
    panes[5]?.getRightPriceScale?.().applyOptions({
      visible: amVisible,
      ticksVisible: amVisible,
      borderVisible: amVisible,
      scaleMargins: { top: 0.08, bottom: 0.08 },
    })

    const measureNativePanes = () => {
      const heights = panes.slice(0, 6).map((pane) => pane?.getHeight?.())
      if (
        heights.length !== 6
        || heights.some((height) => typeof height !== "number" || !Number.isFinite(height) || height < 0)
      ) return
      const [main, volume, rsi, macd, de, am] = heights as [number, number, number, number, number, number]
      const geometry = {
        main,
        volume,
        rsi,
        macd,
        de,
        am,
        drawableHeight: main + volume + rsi + macd + de + am,
      }
      setMeasuredPaneGeometry((current) => (
        current?.key === paneGeometryKey
        && current.geometry.main === main
        && current.geometry.volume === volume
        && current.geometry.rsi === rsi
        && current.geometry.macd === macd
        && current.geometry.de === de
        && current.geometry.am === am
          ? current
          : { key: paneGeometryKey, geometry }
      ))
      onPaneGeometryChange?.({
        ...geometry,
        plotTop: plotContainerRef.current?.offsetTop ?? 0,
      })
    }

    measureNativePanes()
    const measurementFrame = window.requestAnimationFrame(measureNativePanes)
    scheduleOverlayPaint()
    return () => window.cancelAnimationFrame(measurementFrame)
  }, [
    amVisible,
    chartReady,
    deVisible,
    isMaximized,
    onPaneGeometryChange,
    paneGeometryKey,
    paneHeights,
    scheduleOverlayPaint,
  ])

  const updateDrawingFlag = useCallback((id: string, key: "hidden" | "locked") => {
    const drawing = drawings.find((item) => item.id === id)
    if (drawing) modifyDrawing(id, { [key]: !drawing[key] })
  }, [drawings, modifyDrawing])

  const handleIndicatorConfigChange = useCallback((next: typeof indicators) => {
    setIndicators(next)
    setViewSettings((previous: ChartViewSettings) => ({
      ...previous,
      indicatorVisibility: {
        ...previous.indicatorVisibility,
        showMa: next.showMa,
        showRsi: next.showRsi,
        showMacd: next.showMacd,
        showIchimoku: next.showIchimoku,
        showBollinger: next.showBollinger,
        showVolumeProfile: next.showVolumeProfile,
        showQeoBase129: Boolean(next.showQeoBase129),
        showDe: Boolean(next.showDe),
        showAm: Boolean(next.showAm),
      },
    }))
  }, [setIndicators, setViewSettings])

  const editingTextDrawing = editingTextDrawingId
    ? drawings.find((drawing) => drawing.id === editingTextDrawingId) ?? null
    : null
  const editingPosition = editingTextDrawing?.points[0] ?? { x: 24, y: 24 }
  const unsupportedEmpty = displayBars.length === 0 && !isLoading
  const loadingState = isLoading

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-white/10 bg-[#080b10]", isMaximized ? "h-full" : "min-h-[340px]")}>
      <div className="relative z-30 flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] bg-[#0d1118] px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <div className="flex items-center gap-0.5" role="group" aria-label="Khung thời gian">
            {QUICK_TIMEFRAMES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTimeframe(item)}
                disabled={isLoading}
                aria-pressed={timeframe === item}
                className={cn(
                  "rounded px-1.5 py-1 font-mono text-[10px] transition-colors disabled:cursor-wait disabled:opacity-50",
                  timeframe === item ? "bg-cyan-300/10 text-cyan-200" : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-200",
                )}
              >
                {item}
              </button>
            ))}
          </div>

          {isMaximized && <>
            <div className="relative">
              <button
                type="button"
                title="Chỉ báo kỹ thuật"
                onClick={() => setShowIndicatorModal((open) => !open)}
                className="flex items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden md:inline">Indicators</span>
              </button>
              {showIndicatorModal && (
                <StockChartIndicatorModal
                  config={indicators}
                  onChange={handleIndicatorConfigChange}
                  viewSettings={viewSettings}
                  onViewSettingsChange={setViewSettings}
                  onClose={() => setShowIndicatorModal(false)}
                />
              )}
            </div>
            <span className="hidden rounded border border-white/[0.08] px-1.5 py-1 font-mono text-[9px] text-slate-600 lg:inline">Nến Nhật</span>
          </>}
          {!isMaximized && <span className="rounded border border-white/[0.08] px-2 py-1 font-mono text-[10px] text-slate-400">Nến Nhật · Volume · MA20</span>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-2 px-1 font-mono text-[10px] text-slate-500 md:flex">
            <span>{ticker.toUpperCase()}</span>
            {typeof currentPrice === "number" && <span className="text-slate-300">{currentPrice.toFixed(2)}</span>}
            {typeof changePct === "number" && (
              <span className={changePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
              </span>
            )}
          </div>
          {isMaximized && <button
            type="button"
            title="Tải ảnh biểu đồ"
            onClick={() => void handleExport()}
            className="flex items-center gap-1 rounded-md border border-white/[0.1] px-2 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <Camera className="size-3.5" />
            <span className="hidden xl:inline">{exportStatus ?? "Ảnh"}</span>
          </button>}
          {isMaximized && <button
            type="button"
            title="Khôi phục khung nhìn"
            onClick={handleResetView}
            className="flex size-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
          >
            <RotateCcw className="size-3.5" />
          </button>}
          {onToggleMaximize && (
            <button
              type="button"
              title={isMaximized ? "Thu nhỏ chart" : "Phóng to chart"}
              onClick={onToggleMaximize}
              aria-keyshortcuts="Backquote"
              className={cn(
                "flex items-center justify-center gap-1 rounded-md border border-cyan-300/30 bg-cyan-300/[0.08] px-2.5 py-1.5 font-mono text-[10px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-300/[0.16] hover:text-white",
                isMaximized ? "h-8" : "h-9",
              )}
            >
              {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              <span className="hidden sm:inline">{isMaximized ? "Thu nhỏ" : "Toàn màn hình"}</span>
              <kbd className="hidden rounded border border-cyan-200/20 px-1 text-[9px] text-cyan-200/70 md:inline">`</kbd>
            </button>
          )}
        </div>
      </div>

      <div
        ref={plotContainerRef}
        className={cn("relative min-h-0 flex-1 overflow-hidden bg-[#080b10]", isMaximized ? "min-h-0" : "min-h-[300px]")}
        data-chart-plot="lightweight"
        data-chart-price-pane-height={effectivePaneHeights.main}
        data-chart-volume-pane-height={effectivePaneHeights.volume}
        data-chart-rsi-pane-height={effectivePaneHeights.rsi}
        data-chart-macd-pane-height={effectivePaneHeights.macd}
        data-chart-de-pane-height={effectivePaneHeights.de}
        data-chart-am-pane-height={effectivePaneHeights.am}
        data-chart-pane-geometry={measuredPaneGeometry?.key === paneGeometryKey ? "native" : "planned"}
        data-chart-latest-candle-x={latestCandleX ?? ""}
        data-chart-drawable-width={drawingWidth}
      >
        <div
          ref={chartHostRef}
          className="absolute inset-0"
          data-chart-runtime="lightweight-charts-v5"
          data-chart-macd-zero-baseline={isMaximized && effectiveIndicators.showMacd ? "0" : ""}
        />

        <AlignedIndicatorCanvas
          width={overlayWidth}
          height={overlayHeight}
          clipHeight={mainPaneHeight}
          revision={overlayRevision}
          times={allTimes}
          spanA={ichimoku?.spanA ?? []}
          spanB={ichimoku?.spanB ?? []}
          volumeProfile={volumeProfile}
          timeToX={timeToX}
          priceToY={priceToY}
          rsiPaneTop={effectivePaneHeights.main + effectivePaneHeights.volume}
          rsiPriceToY={rsiPriceToY}
          showRsiBand={isMaximized && effectiveIndicators.showRsi}
          priceAxisGutter={priceAxisGutter}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
          <div
            data-chart-ohlcv-overlay
            data-chart-legend-time={legendTime ?? ""}
            data-chart-active-bar-time={activeBar?.time ?? ""}
            className="max-w-[min(86%,920px)] rounded border border-white/[0.08] bg-[#080d13]/95 px-2.5 py-1.5 font-mono text-[11px] leading-5 text-slate-400 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
              <span className="text-slate-500">{activeBar ? formatCrosshairTime(activeBar.time, timeframe) : isHovering ? "Khoảng trống" : "—"}</span>
              <span>O <b className="text-slate-200">{activeBar ? activeBar.open.toFixed(2) : "—"}</b></span>
              <span>H <b className="text-emerald-300">{activeBar ? activeBar.high.toFixed(2) : "—"}</b></span>
              <span>L <b className="text-rose-300">{activeBar ? activeBar.low.toFixed(2) : "—"}</b></span>
              <span>C <b className={activeBar && activeBar.close >= activeBar.open ? "text-emerald-300" : "text-rose-300"}>{activeBar ? activeBar.close.toFixed(2) : "—"}</b></span>
              <span>V <b className="text-slate-200">{activeBar ? formatCompactVolume(activeBar.volume) : "—"}</b></span>
              {effectiveIndicators.showMa && <>
                <span className="text-slate-600">MA20 <b className="text-slate-200">{formatMetric(legendValues.ma20)}</b></span>
                {isMaximized && <>
                  <span className="text-slate-600">MA50 <b className="text-violet-300">{formatMetric(legendValues.ma50)}</b></span>
                  <span className="text-slate-600">MA200 <b className="text-orange-300">{formatMetric(legendValues.ma200)}</b></span>
                </>}
              </>}
              {effectiveIndicators.showBollinger && <span className="text-sky-300">BB {formatMetric(legendValues.bollingerUpper)} / {formatMetric(legendValues.bollingerMiddle)} / {formatMetric(legendValues.bollingerLower)}</span>}
              {effectiveIndicators.showIchimoku && <span className="text-emerald-300">ICHI {formatMetric(legendValues.ichimokuKijun)}</span>}
              {effectiveIndicators.showQeoBase129 && <span className="text-pink-300">QEOBASE {formatMetric(legendValues.qeoBase129)}</span>}
              {effectiveIndicators.showVolumeProfile && <span className="text-amber-300">POC {formatMetric(volumeProfile?.pocPrice ?? null)}</span>}
              {isMaximized && <>
                <span className="text-slate-500">RSI 14 <b style={{ color: rgbaFromHex(viewSettings.indicatorStyles.rsi.color, 0.95) }}>{formatMetric(legendValues.rsi)}</b></span>
                <span className="text-sky-300">MACD {formatMetric(legendValues.macd, 4)}</span>
                <span className="text-orange-300">SIG {formatMetric(legendValues.macdSignal, 4)}</span>
                <span className={legendValues.macdHistogram != null && legendValues.macdHistogram >= 0 ? "text-emerald-300" : "text-rose-300"}>HIST {formatMetric(legendValues.macdHistogram, 4)}</span>
                {deVisible && <span className="text-slate-200">DE {formatMetric(legendValues.de, 2)}</span>}
                {amVisible && <span className="text-yellow-300">AM {formatMetric(legendValues.am, 2)}</span>}
              </>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {effectiveIndicators.showVolumeProfile && <span className="rounded border border-amber-300/20 bg-[#0b0f15]/95 px-2 py-1 font-mono text-[10px] text-amber-200/90">VPVR xấp xỉ OHLCV</span>}
            {effectiveIndicators.showIchimoku && <span className="rounded border border-emerald-300/20 bg-[#0b0f15]/95 px-2 py-1 font-mono text-[10px] text-emerald-200/90">Ichimoku Cloud</span>}
            {runtimeError && <span className="rounded border border-rose-300/20 bg-[#170d12]/95 px-2 py-1 font-mono text-[10px] text-rose-200">{runtimeError}</span>}
          </div>
        </div>

        {deVisible && (
          <div
            data-chart-pane-header="de"
            style={{ top: effectivePaneHeights.main + effectivePaneHeights.volume + effectivePaneHeights.rsi + effectivePaneHeights.macd + 4 }}
            className="pointer-events-none absolute left-11 z-20 flex h-5 items-center gap-2 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className="font-semibold text-slate-200">DE</span>
            <span className="text-slate-300/90">{formatMetric(legendValues.de, 2)}</span>
            <span className="text-slate-500">弘历背离王</span>
          </div>
        )}

        {amVisible && (
          <div
            data-chart-pane-header="am"
            style={{ top: effectivePaneHeights.main + effectivePaneHeights.volume + effectivePaneHeights.rsi + effectivePaneHeights.macd + effectivePaneHeights.de + 5 }}
            className="pointer-events-none absolute left-11 z-20 flex h-5 items-center gap-2 whitespace-nowrap font-mono text-[10px] tabular-nums"
          >
            <span className="font-semibold text-yellow-300">AM</span>
            <span className="text-yellow-200/85">{formatMetric(legendValues.am, 2)}</span>
            <span className="text-slate-600">Accumulate · reconstructed</span>
          </div>
        )}

        {isMaximized && <StockChartDrawingTools
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          activeColor={activeColor}
          onChangeColor={setActiveColor}
          lineWidth={lineWidth}
          onChangeLineWidth={setLineWidth}
          selectedIconType={selectedIconType}
          onSelectIconType={setSelectedIconType}
          isLocked={isDrawingsLocked}
          onToggleLock={() => setIsDrawingsLocked((value) => !value)}
          isHidden={isDrawingsHidden}
          onToggleHide={() => setIsDrawingsHidden((value) => !value)}
          onClearAll={clearAllDrawings}
          onToggleObjectManager={() => setIsObjectManagerOpen((value) => !value)}
          isObjectManagerOpen={isObjectManagerOpen}
          drawingsCount={drawings.length}
          saveStatus={saveStatus}
          drawingSyncStatus={drawingSyncStatus}
          onRetryDrawingSync={retryChartHydration}
        />}

        {isMaximized && isObjectManagerOpen && (
          <StockChartObjectManager
            drawings={drawings}
            selectedId={selectedDrawingId}
            onSelect={setSelectedDrawingId}
            onToggleHide={(id) => updateDrawingFlag(id, "hidden")}
            onToggleLock={(id) => updateDrawingFlag(id, "locked")}
            onDelete={(id) => {
              deleteDrawing(id)
              if (selectedDrawingId === id) setSelectedDrawingId(null)
            }}
            onEditText={setEditingTextDrawingId}
            onClearAll={clearAllDrawings}
            onClose={() => setIsObjectManagerOpen(false)}
          />
        )}

        {isMaximized && editingTextDrawing && (
          <StockChartTextEditor
            initialText={editingTextDrawing.text ?? ""}
            initialColor={editingTextDrawing.color}
            initialFontSize={editingTextDrawing.fontSize}
            position={editingPosition}
            containerWidth={overlayWidth}
            containerHeight={overlayHeight}
            onSave={(text, color, fontSize) => {
              modifyDrawing(editingTextDrawing.id, { text, color, fontSize })
              setEditingTextDrawingId(null)
            }}
            onCancel={() => setEditingTextDrawingId(null)}
          />
        )}

        {!runtimeError && !loadingState && unsupportedEmpty && (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-6">
            <div className="rounded-xl border border-white/[0.08] bg-[#0c131c]/95 px-5 py-4 text-center shadow-xl">
              <div className="text-sm font-semibold text-slate-200">{`Khung ${timeframe} hiện chưa có dữ liệu nến hoàn tất.`}</div>
              <div className="mt-1 text-xs text-slate-500">Không có dữ liệu OHLCV thật trong khoảng thời gian yêu cầu.</div>
            </div>
          </div>
        )}
        {loadingState && (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-6">
            <div className="rounded-xl border border-white/[0.08] bg-[#0c131c]/95 px-5 py-4 text-center shadow-xl">
              <div className="text-sm font-semibold text-slate-200">Đang tải dữ liệu nến…</div>
              <div className="mt-1 text-xs text-slate-500">Đang đọc dữ liệu thị trường thật…</div>
            </div>
          </div>
        )}

        {isMaximized && <StockChartDrawingCanvas
          width={drawingWidth}
          height={mainPaneHeight}
          drawings={drawings}
          selectedId={selectedDrawingId}
          onSelectDrawing={setSelectedDrawingId}
          onAddDrawing={addDrawing}
          onUpdateDrawing={modifyDrawing}
          onDeleteDrawing={deleteDrawing}
          onEditText={setEditingTextDrawingId}
          activeTool={activeTool}
          activeColor={activeColor}
          lineWidth={lineWidth}
          selectedIconType={selectedIconType}
          isLocked={isDrawingsLocked}
          isHidden={isDrawingsHidden}
          priceToY={priceToY}
          yToPrice={yToPrice}
          timeToX={timeToX}
          xToTime={xToTime}
          drawingReady={drawingSyncStatus === "ready"}
          onDrawingComplete={() => setActiveTool("cursor")}
        />}

        {isMaximized && (
          <>
            <button
              type="button"
              title={isRsiCollapsed ? "Mở pane RSI" : "Thu gọn pane RSI"}
              onClick={() => {
                const next = !isRsiCollapsed
                setIsRsiCollapsed(next)
                setViewSettings((previous: ChartViewSettings) => ({ ...previous, rsiCollapsed: next }))
              }}
              style={{ top: `${effectivePaneHeights.main + effectivePaneHeights.volume + 2}px` }}
              className="absolute right-2 z-40 flex size-5 items-center justify-center rounded border border-white/15 bg-[#111820]/95 font-mono text-[12px] font-bold text-slate-300 shadow transition-colors hover:bg-white/10 hover:text-white"
            >
              {isRsiCollapsed ? "+" : "−"}
            </button>
            <button
              type="button"
              title={isMacdCollapsed ? "Mở pane MACD" : "Thu gọn pane MACD"}
              onClick={() => {
                const next = !isMacdCollapsed
                setIsMacdCollapsed(next)
                setViewSettings((previous: ChartViewSettings) => ({ ...previous, macdCollapsed: next }))
              }}
              style={{ top: `${effectivePaneHeights.main + effectivePaneHeights.volume + effectivePaneHeights.rsi + 3}px` }}
              className="absolute right-2 z-40 flex size-5 items-center justify-center rounded border border-white/15 bg-[#111820]/95 font-mono text-[12px] font-bold text-slate-300 shadow transition-colors hover:bg-white/10 hover:text-white"
            >
              {isMacdCollapsed ? "+" : "−"}
            </button>
          </>
        )}
      </div>

      {isMaximized && <div className="flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-t border-white/[0.08] bg-[#070b10] px-2 py-1 text-[10px] font-mono select-none">
        <div className="flex items-center gap-0.5">
          {[
            { label: "5N", bars: 1250, title: "5 năm gần nhất" },
            { label: "3N", bars: 750, title: "3 năm gần nhất" },
            { label: "1N", bars: 250, title: "1 năm gần nhất" },
            { label: "6T", bars: 130, title: "6 tháng gần nhất" },
            { label: "3T", bars: 66, title: "3 tháng gần nhất" },
            { label: "1T", bars: 22, title: "1 tháng gần nhất" },
            { label: "Tất cả", bars: displayBars.length, title: "Toàn bộ lịch sử" },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.title}
              onClick={() => setVisibleBars(preset.bars)}
              className="rounded-sm px-2 py-0.5 font-semibold text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-slate-100"
            >
              {preset.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/[0.08]" />
          <span className="flex size-6 items-center justify-center rounded-sm text-slate-500" title="Điều hướng trục thời gian">
            <CalendarDays className="size-3.5" />
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1 text-slate-500">
          <span className="hidden px-1.5 md:inline">UTC+7</span>
          <span className="rounded-sm px-1.5 py-0.5">%</span>
          <button
            type="button"
            title="Tự căn khung nhìn vừa dữ liệu"
            onClick={handleResetView}
            className="rounded-sm px-1.5 py-0.5 font-semibold text-cyan-400 transition-colors hover:bg-white/[0.05] hover:text-cyan-300"
          >
            tự động
          </button>
          <span className="hidden pl-2 text-[9px] text-slate-600 lg:inline">
            {displayBars.length} nến · vùng trống +{futureTimes.length}
          </span>
        </div>
      </div>}
    </div>
  )
}
