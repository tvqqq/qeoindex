"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toPng } from "html-to-image"
import {
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import {
  loadLightweightCharts,
  type LightweightChartApi,
  type LightweightSeriesApi,
} from "@/modules/shared/charts/lightweight-charts-runtime"
import { cn } from "@/modules/shared/ui/cn"
import { StockChartDrawingCanvas } from "./chart/stock-chart-drawing-canvas"
import { StockChartDrawingTools } from "./chart/stock-chart-drawing-tools"
import { StockChartIndicatorModal } from "./chart/stock-chart-indicator-modal"
import { StockChartObjectManager } from "./chart/stock-chart-object-manager"
import { StockChartTextEditor } from "./chart/stock-chart-text-editor"
import { boundChartTimeToTimeline, bridgeCoordinateToTime, bridgeTimeToCoordinate } from "./chart/chart-coordinate-bridge"
import { canIncrementallyUpdateLatest, fingerprintOhlcvPrefix } from "./chart/chart-render-diff"
import {
  calculateBollingerBands,
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
  ALL_TIMEFRAMES,
  DEFAULT_INDICATOR_CONFIG,
  QUICK_TIMEFRAMES,
  type ChartTimeframe,
  type DrawingIconType,
  type DrawingTool,
  type VolumeProfileData,
} from "./chart/stock-chart-types"
import { useUserChartSync } from "./chart/use-user-chart-sync"
import { useCanonicalMinuteBars } from "./chart/use-canonical-minute-bars"

interface StockTradingViewChartProps {
  ticker: string
  bars: OhlcvBar[]
  hourlyBars?: OhlcvBar[]
  isLoading?: boolean
  isMaximized?: boolean
  onToggleMaximize?: () => void
  currentPrice?: number
  changePct?: number
}

const DEFAULT_RIGHT_OFFSET_BARS = 8
const MIN_MAX_RIGHT_OFFSET_BARS = 32
const EXPANDED_SUBPANE_HEIGHT = 92
const COLLAPSED_SUBPANE_HEIGHT = 24
const VOLUME_PANE_HEIGHT = 64
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

function volumeData(bars: OhlcvBar[]): Record<string, unknown>[] {
  return bars.map((bar) => ({
    time: bar.time,
    value: bar.volume,
    color: bar.close >= bar.open ? "rgba(34,201,138,0.42)" : "rgba(255,71,87,0.42)",
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
    context.beginPath()
    context.rect(0, 0, width, Math.max(0, Math.min(height, clipHeight)))
    context.clip()

    if (volumeProfile && volumeProfile.maxBucketVol > 0 && volumeProfile.buckets.length > 0) {
      const centers = volumeProfile.buckets.map((bucket) => bucket.price)
      const step = centers.length > 1
        ? Math.abs(centers[1] - centers[0])
        : Math.max(Math.abs(centers[0]) * 0.01, 0.01)
      const maxWidth = Math.min(180, Math.max(56, width * 0.24))
      for (const bucket of volumeProfile.buckets) {
        const topCoordinate = priceToY(bucket.price + step / 2)
        const bottomCoordinate = priceToY(bucket.price - step / 2)
        if (topCoordinate == null || bottomCoordinate == null) continue
        const top = Math.min(topCoordinate, bottomCoordinate)
        const bucketHeight = Math.max(1, Math.abs(bottomCoordinate - topCoordinate) - 1)
        const widthRatio = Math.max(0, Math.min(1, bucket.volume / volumeProfile.maxBucketVol))
        const barWidth = Math.max(1, maxWidth * widthRatio)
        context.fillStyle = bucket.isPoc ? "rgba(245,158,11,0.54)" : "rgba(245,158,11,0.22)"
        context.fillRect(Math.max(0, width - barWidth - 4), top, barWidth, bucketHeight)
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
  }, [clipHeight, height, priceToY, revision, spanA, spanB, timeToX, times, volumeProfile, width])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2]"
      data-chart-indicator-overlay="aligned"
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
}: StockTradingViewChartProps) {
  const {
    timeframe,
    setTimeframe,
    indicators,
    setIndicators,
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
    defaultTimeframe: "1D",
    defaultChartStyle: "candles",
    defaultIndicators: DEFAULT_INDICATOR_CONFIG,
  })

  const minuteBars = useCanonicalMinuteBars({ ticker, enabled: timeframe === "1m" })
  const displayBars = useMemo(
    () => normalizeBars(
      timeframe === "1m"
        ? minuteBars.bars
        : aggregateBarsByTimeframe(bars, hourlyBars, timeframe),
    ),
    [bars, hourlyBars, minuteBars.bars, timeframe],
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
    () => indicators.showBollinger ? calculateBollingerBands(displayBars, 20, 2) : null,
    [displayBars, indicators.showBollinger],
  )
  const ichimoku = useMemo(
    () => indicators.showIchimoku ? calculateIchimokuSeries(displayBars) : null,
    [displayBars, indicators.showIchimoku],
  )
  const qeoBase129 = useMemo(
    () => indicators.showQeoBase129 ? calculateIchimokuBaseSeries(displayBars, 129) : [],
    [displayBars, indicators.showQeoBase129],
  )
  const rsi = useMemo(
    () => isMaximized ? calculateRsiSeries(displayBars, 14) : [],
    [displayBars, isMaximized],
  )
  const macd = useMemo(
    () => isMaximized ? calculateMacdSeries(displayBars) : null,
    [displayBars, isMaximized],
  )

  const renderPayload = useMemo(() => ({
    candle: candleData(displayBars),
    futureAxis: futureAxisData(futureTimes),
    volume: volumeData(displayBars),
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
    macd: lineData(macd?.macd ?? [], barTimes),
    macdSignal: lineData(macd?.signal ?? [], barTimes),
    macdHistogram: lineData(macd?.histogram ?? [], barTimes),
  }), [
    allTimes,
    barTimes,
    bollinger,
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
  ])

  const plotContainerRef = useRef<HTMLDivElement>(null)
  const chartHostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<LightweightChartApi | null>(null)
  const seriesRef = useRef<ChartSeries | null>(null)
  const chartGenerationRef = useRef(0)
  const renderedRef = useRef<RenderedData | null>(null)
  const visibleRangeRef = useRef<{ from: number; to: number } | null>(null)
  const overlayFrameRef = useRef<number | null>(null)
  const [chartReady, setChartReady] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<ChartDimensions>({ width: 0, height: 0 })
  const [visibleRangeState, setVisibleRangeState] = useState<{ from: number; to: number } | null>(null)
  const [overlayRevision, setOverlayRevision] = useState(0)
  const [crosshairTime, setCrosshairTime] = useState<number | null>(null)
  const [showTfDropdown, setShowTfDropdown] = useState(false)
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

  const scheduleOverlayPaint = useCallback(() => {
    if (typeof window === "undefined" || overlayFrameRef.current !== null) return
    overlayFrameRef.current = window.requestAnimationFrame(() => {
      overlayFrameRef.current = null
      setOverlayRevision((revision) => revision + 1)
    })
  }, [])

  const activeBar = findBarAtTime(displayBars, crosshairTime) ?? displayBars.at(-1) ?? null
  const overlayWidth = dimensions.width || 1000
  const overlayHeight = dimensions.height || (isMaximized ? 640 : 340)
  const mainPaneHeight = Math.max(
    1,
    overlayHeight
      - VOLUME_PANE_HEIGHT
      - (isMaximized ? (isRsiCollapsed ? COLLAPSED_SUBPANE_HEIGHT : EXPANDED_SUBPANE_HEIGHT) : 0)
      - (isMaximized ? (isMacdCollapsed ? COLLAPSED_SUBPANE_HEIGHT : EXPANDED_SUBPANE_HEIGHT) : 0),
  )

  // LWC owns the scales. Drawings are the only SVG overlay and always derive
  // their screen coordinates from current LWC series/time-scale coordinates.
  const priceToY = useCallback((price: number) => {
    return seriesRef.current?.candles.priceToCoordinate?.(price) ?? null
  }, [])
  const yToPrice = useCallback((y: number) => {
    return seriesRef.current?.candles.coordinateToPrice?.(y) ?? null
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

  const volumeProfile = useMemo(() => {
    if (!indicators.showVolumeProfile || displayBars.length === 0) return null
    const range = visibleRangeState
    if (!range) return calculateVolumeProfile(displayBars, 20)
    const from = Math.max(0, Math.floor(range.from))
    const to = Math.min(displayBars.length, Math.ceil(range.to) + 1)
    return calculateVolumeProfile(displayBars.slice(from, Math.max(from, to)), 20)
  }, [displayBars, indicators.showVolumeProfile, visibleRangeState])

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
    const range = {
      from: Math.max(-0.5, displayBars.length - visibleBars),
      to: displayBars.length - 1 + rightOffset,
    }
    chart.timeScale().setVisibleLogicalRange(range)
    visibleRangeRef.current = range
    setVisibleRangeState(range)
  }, [displayBars.length])

  const setVisibleBars = useCallback((count: number) => {
    const chart = chartRef.current
    if (!chart || displayBars.length === 0) return
    const visible = Math.min(displayBars.length, Math.max(15, count))
    const rightOffset = DEFAULT_RIGHT_OFFSET_BARS
    const range = {
      from: Math.max(-0.5, displayBars.length - visible),
      to: displayBars.length - 1 + rightOffset,
    }
    chart.applyOptions({ timeScale: { rightOffset } })
    chart.timeScale().setVisibleLogicalRange(range)
    visibleRangeRef.current = range
    setVisibleRangeState(range)
  }, [displayBars.length])

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

  // A ticker/timeframe generation owns one LWC instance. Cleanup invalidates
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
    visibleRangeRef.current = null
    seriesRef.current = null

    void loadLightweightCharts()
      .then((runtime) => {
        if (disposed || chartGenerationRef.current !== generation || !host.isConnected) return

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
            timeVisible: timeframe.includes("m") || timeframe.includes("h"),
            secondsVisible: false,
            rightOffset: DEFAULT_RIGHT_OFFSET_BARS,
            barSpacing: 7,
            minBarSpacing: 2,
            tickMarkFormatter: (time: unknown) => formatAxisTime(time, timeframe),
          },
          localization: {
            locale: "vi-VN",
            timeFormatter: (time: unknown) => formatCrosshairTime(time, timeframe),
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
            ...chartSeriesOptions(false, "#a78bfa", 1),
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 2, minMove: 0.01 },
            title: "RSI 14",
          }, 2),
          macd: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#2196f3", 1),
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
            title: "MACD",
          }, 3),
          macdSignal: chart.addSeries(runtime.LineSeries, {
            ...chartSeriesOptions(false, "#f97316", 1),
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
            title: "Signal",
          }, 3),
          macdHistogram: chart.addSeries(runtime.HistogramSeries, {
            visible: false,
            priceScaleId: "right",
            priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
            priceLineVisible: false,
            lastValueVisible: false,
          }, 3),
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
      visibleRangeRef.current = null
      setChartReady(false)
    }
  }, [scheduleOverlayPaint, ticker, timeframe])

  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series || !chartReady) return

    series.ma20.applyOptions({ visible: indicators.showMa })
    series.ma50.applyOptions({ visible: indicators.showMa })
    series.ma200.applyOptions({ visible: indicators.showMa })
    series.bollingerUpper.applyOptions({ visible: indicators.showBollinger })
    series.bollingerMiddle.applyOptions({ visible: indicators.showBollinger })
    series.bollingerLower.applyOptions({ visible: indicators.showBollinger })
    series.ichimokuTenkan.applyOptions({ visible: indicators.showIchimoku })
    series.ichimokuKijun.applyOptions({ visible: indicators.showIchimoku })
    series.ichimokuSpanA.applyOptions({ visible: indicators.showIchimoku })
    series.ichimokuSpanB.applyOptions({ visible: indicators.showIchimoku })
    series.ichimokuChikou.applyOptions({ visible: indicators.showIchimoku })
    series.qeoBase129.applyOptions({ visible: Boolean(indicators.showQeoBase129) })
    series.rsi.applyOptions({ visible: isMaximized })
    series.macd.applyOptions({ visible: isMaximized })
    series.macdSignal.applyOptions({ visible: isMaximized })
    series.macdHistogram.applyOptions({ visible: isMaximized })

    const previous = renderedRef.current
    const latest = displayBars.at(-1)
    const canUpdateLatest = canIncrementallyUpdateLatest(previous, displayBars)
      && previous?.futureLength === futureTimes.length

    series.futureAxis.setData(renderPayload.futureAxis)
    if (displayBars.length === 0) {
      series.candles.setData([])
      series.volume.setData([])
      renderedRef.current = null
    } else if (canUpdateLatest) {
      const last = displayBars.at(-1)!
      series.candles.update({ time: last.time, open: last.open, high: last.high, low: last.low, close: last.close })
      series.volume.update({
        time: last.time,
        value: last.volume,
        color: last.close >= last.open ? "rgba(34,201,138,0.42)" : "rgba(255,71,87,0.42)",
      })
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
    series.macd.setData(renderPayload.macd)
    series.macdSignal.setData(renderPayload.macdSignal)
    series.macdHistogram.setData(renderPayload.macdHistogram)

    if (displayBars.length > 0 && !previous) {
      setLatestVisibleRange()
    } else if (previous && visibleRangeRef.current && displayBars[0]?.time < previous.firstTime) {
      // Prepending older history shifts logical indexes. Preserve the user's
      // current viewport instead of fitting the chart on every refresh.
      const shift = displayBars.length - previous.actualLength
      const range = {
        from: visibleRangeRef.current.from + shift,
        to: visibleRangeRef.current.to + shift,
      }
      chart.timeScale().setVisibleLogicalRange(range)
      visibleRangeRef.current = range
      setVisibleRangeState(range)
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
    chartReady,
    displayBars,
    barFingerprint,
    futureTimes.length,
    indicators,
    isMaximized,
    renderPayload,
    scheduleOverlayPaint,
    setLatestVisibleRange,
  ])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !chartReady) return
    const panes = chart.panes()
    panes[1]?.setHeight(VOLUME_PANE_HEIGHT)
    panes[2]?.setHeight(isMaximized ? (isRsiCollapsed ? COLLAPSED_SUBPANE_HEIGHT : EXPANDED_SUBPANE_HEIGHT) : 0)
    panes[3]?.setHeight(isMaximized ? (isMacdCollapsed ? COLLAPSED_SUBPANE_HEIGHT : EXPANDED_SUBPANE_HEIGHT) : 0)
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
    scheduleOverlayPaint()
  }, [chartReady, isMacdCollapsed, isMaximized, isRsiCollapsed, scheduleOverlayPaint])

  const updateDrawingFlag = useCallback((id: string, key: "hidden" | "locked") => {
    const drawing = drawings.find((item) => item.id === id)
    if (drawing) modifyDrawing(id, { [key]: !drawing[key] })
  }, [drawings, modifyDrawing])

  const editingTextDrawing = editingTextDrawingId
    ? drawings.find((drawing) => drawing.id === editingTextDrawingId) ?? null
    : null
  const editingPosition = editingTextDrawing?.points[0] ?? { x: 24, y: 24 }
  const timeframeGroups = useMemo(() => {
    const groups = new Map<string, typeof ALL_TIMEFRAMES>()
    for (const item of ALL_TIMEFRAMES) {
      const group = groups.get(item.group) ?? []
      group.push(item)
      groups.set(item.group, group)
    }
    return [...groups.entries()]
  }, [])
  const unsupportedEmpty = displayBars.length === 0 && !isLoading && !(timeframe === "1m" && minuteBars.status === "loading")
  const loadingState = isLoading || (timeframe === "1m" && minuteBars.status === "loading")

  return (
    <div className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[10px] border border-white/10 bg-[#080b10]", isMaximized ? "h-full" : "min-h-[340px]")}>
      <div className="relative z-30 flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] bg-[#0d1118] px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTfDropdown((open) => !open)}
              className="flex items-center gap-1 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 font-mono text-[11px] font-bold text-slate-200 transition-colors hover:bg-white/[0.08]"
              aria-label="Chọn khung thời gian"
            >
              {timeframe}
              <ChevronDown className="size-3 text-slate-500" />
            </button>
            {showTfDropdown && (
              <>
                <button
                  type="button"
                  aria-label="Đóng chọn khung thời gian"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setShowTfDropdown(false)}
                />
                <div className="absolute left-0 top-8 z-50 w-[min(520px,calc(100vw-24px))] rounded-lg border border-white/[0.12] bg-[#0b0f15] p-2 shadow-[0_18px_52px_rgba(0,0,0,0.82)]">
                  <div className="grid grid-cols-4 divide-x divide-white/[0.08]">
                    {timeframeGroups.map(([group, items]) => (
                      <div key={group} className="min-w-0 px-2 first:pl-0 last:pr-0">
                        <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">{group}</div>
                        {items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setTimeframe(item.id)
                              setShowTfDropdown(false)
                            }}
                            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
                          >
                            <span className="w-8 shrink-0 text-left font-mono text-[11px] font-bold">{item.id}</span>
                            <span className="truncate text-[10px]">{item.label}</span>
                            {item.id === timeframe && <Check className="ml-auto size-3.5 shrink-0 text-cyan-400" />}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="hidden items-center gap-0.5 sm:flex">
            {QUICK_TIMEFRAMES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTimeframe(item)}
                className={cn(
                  "rounded px-1.5 py-1 font-mono text-[10px] transition-colors",
                  timeframe === item ? "bg-cyan-300/10 text-cyan-200" : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-200",
                )}
              >
                {item}
              </button>
            ))}
          </div>

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
                onChange={setIndicators}
                onClose={() => setShowIndicatorModal(false)}
              />
            )}
          </div>
          <span className="hidden rounded border border-white/[0.08] px-1.5 py-1 font-mono text-[9px] text-slate-600 lg:inline">Nến Nhật</span>
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
          <button
            type="button"
            title="Tải ảnh biểu đồ"
            onClick={() => void handleExport()}
            className="flex items-center gap-1 rounded-md border border-white/[0.1] px-2 py-1 font-mono text-[10px] text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <Camera className="size-3.5" />
            <span className="hidden xl:inline">{exportStatus ?? "Ảnh"}</span>
          </button>
          <button
            type="button"
            title="Khôi phục khung nhìn"
            onClick={handleResetView}
            className="flex size-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-100"
          >
            <RotateCcw className="size-3.5" />
          </button>
          {onToggleMaximize && (
            <button
              type="button"
              title={isMaximized ? "Thu nhỏ chart" : "Phóng to chart"}
              onClick={onToggleMaximize}
              className="flex size-7 items-center justify-center rounded-md border border-white/[0.1] bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              {isMaximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          )}
        </div>
      </div>

      <div
        ref={plotContainerRef}
        className={cn("relative min-h-0 flex-1 overflow-hidden bg-[#080b10]", isMaximized ? "min-h-0" : "min-h-[300px]")}
        data-chart-plot="lightweight"
      >
        <div ref={chartHostRef} className="absolute inset-0" data-chart-runtime="lightweight-charts-v5" />

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
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
          {activeBar ? (
            <div data-chart-ohlcv-overlay className="flex flex-wrap items-center gap-2 rounded border border-white/[0.06] bg-[#080d13]/95 px-2.5 py-1 font-mono text-[10px] text-slate-400">
              <span className="text-slate-500">{formatCrosshairTime(activeBar.time, timeframe)}</span>
              <span>O <b className="text-slate-200">{activeBar.open.toFixed(2)}</b></span>
              <span>H <b className="text-emerald-300">{activeBar.high.toFixed(2)}</b></span>
              <span>L <b className="text-rose-300">{activeBar.low.toFixed(2)}</b></span>
              <span>C <b className={activeBar.close >= activeBar.open ? "text-emerald-300" : "text-rose-300"}>{activeBar.close.toFixed(2)}</b></span>
              <span>V <b className="text-slate-200">{formatCompactVolume(activeBar.volume)}</b></span>
            </div>
          ) : (
            <div data-chart-ohlcv-overlay className="rounded border border-white/[0.06] bg-[#080d13]/95 px-2.5 py-1 font-mono text-[10px] text-slate-600">OHLCV —</div>
          )}
          <div className="flex items-center gap-1">
            {indicators.showVolumeProfile && <span className="rounded border border-amber-300/20 bg-[#0b0f15]/95 px-2 py-1 font-mono text-[9px] text-amber-200/75">Volume Profile · vùng hiển thị</span>}
            {indicators.showIchimoku && <span className="rounded border border-emerald-300/20 bg-[#0b0f15]/95 px-2 py-1 font-mono text-[9px] text-emerald-200/75">Ichimoku Cloud</span>}
            {runtimeError && <span className="rounded border border-rose-300/20 bg-[#170d12]/95 px-2 py-1 font-mono text-[9px] text-rose-200">{runtimeError}</span>}
          </div>
        </div>

        <StockChartDrawingTools
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
        />

        {isObjectManagerOpen && (
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

        {editingTextDrawing && (
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

        <StockChartDrawingCanvas
          width={overlayWidth}
          height={overlayHeight}
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
        />

        {isMaximized && (
          <>
            <button
              type="button"
              title={isRsiCollapsed ? "Mở pane RSI" : "Thu gọn pane RSI"}
              onClick={() => {
                setIsRsiCollapsed((value) => !value)
                const next = !isRsiCollapsed
                chartRef.current?.panes()[2]?.setHeight(next ? COLLAPSED_SUBPANE_HEIGHT : EXPANDED_SUBPANE_HEIGHT)
              }}
              className="absolute right-2 top-[62%] z-40 flex size-5 items-center justify-center rounded border border-white/15 bg-[#111820]/95 font-mono text-[12px] font-bold text-slate-300 shadow transition-colors hover:bg-white/10 hover:text-white"
            >
              {isRsiCollapsed ? "+" : "−"}
            </button>
            <button
              type="button"
              title={isMacdCollapsed ? "Mở pane MACD" : "Thu gọn pane MACD"}
              onClick={() => {
                setIsMacdCollapsed((value) => !value)
                const next = !isMacdCollapsed
                chartRef.current?.panes()[3]?.setHeight(next ? COLLAPSED_SUBPANE_HEIGHT : EXPANDED_SUBPANE_HEIGHT)
              }}
              className="absolute right-2 bottom-2 z-40 flex size-5 items-center justify-center rounded border border-white/15 bg-[#111820]/95 font-mono text-[12px] font-bold text-slate-300 shadow transition-colors hover:bg-white/10 hover:text-white"
            >
              {isMacdCollapsed ? "+" : "−"}
            </button>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 overflow-x-auto border-t border-white/[0.08] bg-[#070b10] px-2 py-1 text-[10px] font-mono select-none">
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
      </div>
    </div>
  )
}
