"use client"

import React, { useCallback, useMemo, useRef, useState } from "react"
import {
  Camera,
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { cn } from "@/modules/shared/ui/cn"
import { StockChartDrawingCanvas } from "./chart/stock-chart-drawing-canvas"
import { StockChartDrawingTools } from "./chart/stock-chart-drawing-tools"
import { StockChartIndicatorModal } from "./chart/stock-chart-indicator-modal"
import { StockChartObjectManager } from "./chart/stock-chart-object-manager"
import { StockChartTextEditor } from "./chart/stock-chart-text-editor"
import {
  calculateBollingerBands,
  calculateIchimokuSeries,
  calculateMacdSeries,
  calculateRsiSeries,
  calculateSma,
  calculateVolumeProfile,
} from "./chart/stock-chart-indicators"
import { aggregateBarsByTimeframe } from "./chart/stock-chart-timeframes"
import {
  ALL_TIMEFRAMES,
  DEFAULT_INDICATOR_CONFIG,
  QUICK_TIMEFRAMES,
  type DrawingIconType,
  type DrawingTool,
} from "./chart/stock-chart-types"
import { useUserChartSync } from "./chart/use-user-chart-sync"

interface StockTradingViewChartProps {
  ticker: string
  bars: OhlcvBar[]
  hourlyBars?: OhlcvBar[]
  isMaximized?: boolean
  onToggleMaximize?: () => void
  currentPrice?: number
  changePct?: number
}

export function StockTradingViewChart({
  ticker,
  bars,
  hourlyBars,
  isMaximized = false,
  onToggleMaximize,
  currentPrice,
  changePct,
}: StockTradingViewChartProps) {
  // 1. Persistent User Chart Settings & Drawings Hook
  const {
    timeframe,
    setTimeframe,
    chartStyle,
    setChartStyle,
    indicators,
    setIndicators,
    drawings,
    addDrawing,
    modifyDrawing,
    deleteDrawing,
    clearAllDrawings,
    saveStatus,
  } = useUserChartSync({
    ticker,
    defaultTimeframe: "1D",
    defaultChartStyle: "candles",
    defaultIndicators: DEFAULT_INDICATOR_CONFIG,
  })

  // Dropdown states
  const [showTfDropdown, setShowTfDropdown] = useState(false)
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)
  const [showIndicatorModal, setShowIndicatorModal] = useState(false)

  // Drawing tools state
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor")
  const [activeColor, setActiveColor] = useState<string>("#00f0ff")
  const [lineWidth, setLineWidth] = useState<number>(2)
  const [selectedIconType, setSelectedIconType] = useState<DrawingIconType>("flag")
  const [isDrawingsLocked, setIsDrawingsLocked] = useState(false)
  const [isDrawingsHidden, setIsDrawingsHidden] = useState(false)

  // Interactive selection, Object Manager & Text Editor states
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [isObjectManagerOpen, setIsObjectManagerOpen] = useState(false)
  const [editingTextDrawingId, setEditingTextDrawingId] = useState<string | null>(null)

  // Viewport zoom and scroll state (TradingView style)
  const [visibleBarsCount, setVisibleBarsCount] = useState<number>(75)
  const [scrollOffset, setScrollOffset] = useState<number>(0) // 0 = rightmost recent bars; >0 = scrolled left into history
  const containerRef = useRef<HTMLDivElement>(null)
  const isPanningRef = useRef(false)
  const panStartXRef = useRef(0)
  const panStartOffsetRef = useRef(0)

  // Hover crosshair state (X bar index and Y position in SVG space)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverY, setHoverY] = useState<number | null>(null)

  // Aggregated bars based on selected timeframe
  const displayBars = useMemo(() => {
    return aggregateBarsByTimeframe(bars, hourlyBars, timeframe)
  }, [bars, hourlyBars, timeframe])

  // Compute visible slice of bars based on scrollOffset & visibleBarsCount
  const totalBars = displayBars.length
  const maxScrollOffset = Math.max(0, totalBars - 15)
  const clampedScrollOffset = Math.max(0, Math.min(maxScrollOffset, scrollOffset))
  const endIdx = Math.max(15, totalBars - clampedScrollOffset)
  const startIdx = Math.max(0, endIdx - visibleBarsCount)

  const visibleBars = useMemo(() => {
    if (displayBars.length === 0) return []
    return displayBars.slice(startIdx, endIdx)
  }, [displayBars, startIdx, endIdx])

  // Technical Indicators calculations on full displayBars, then mapped
  const ma20All = useMemo(() => calculateSma(displayBars, 20), [displayBars])
  const ma50All = useMemo(() => calculateSma(displayBars, 50), [displayBars])
  const ma200All = useMemo(() => calculateSma(displayBars, 200), [displayBars])

  const rsiSeriesAll = useMemo(() => {
    return isMaximized && indicators.showRsi ? calculateRsiSeries(displayBars, 14) : []
  }, [displayBars, isMaximized, indicators.showRsi])

  const macdSeriesAllRaw = useMemo(() => {
    return isMaximized && indicators.showMacd ? calculateMacdSeries(displayBars) : null
  }, [displayBars, isMaximized, indicators.showMacd])

  const macdSeriesAll = useMemo(() => {
    if (!macdSeriesAllRaw) return null
    return {
      macd: macdSeriesAllRaw.macd.slice(startIdx, endIdx),
      signal: macdSeriesAllRaw.signal.slice(startIdx, endIdx),
      histogram: macdSeriesAllRaw.histogram.slice(startIdx, endIdx),
    }
  }, [macdSeriesAllRaw, startIdx, endIdx])

  const ichimokuAll = useMemo(() => {
    return isMaximized && indicators.showIchimoku ? calculateIchimokuSeries(displayBars) : null
  }, [displayBars, isMaximized, indicators.showIchimoku])

  const bollingerAll = useMemo(() => {
    return isMaximized && indicators.showBollinger ? calculateBollingerBands(displayBars, 20, 2) : null
  }, [displayBars, isMaximized, indicators.showBollinger])

  // Visible slices of indicators
  const ma20 = useMemo(() => ma20All.slice(startIdx, endIdx), [ma20All, startIdx, endIdx])
  const ma50 = useMemo(() => ma50All.slice(startIdx, endIdx), [ma50All, startIdx, endIdx])
  const ma200 = useMemo(() => ma200All.slice(startIdx, endIdx), [ma200All, startIdx, endIdx])
  const rsiSeries = useMemo(() => rsiSeriesAll.slice(startIdx, endIdx), [rsiSeriesAll, startIdx, endIdx])
  const macdSeries = macdSeriesAll

  const ichimoku = useMemo(() => {
    if (!ichimokuAll) return null
    return {
      tenkan: ichimokuAll.tenkan.slice(startIdx, endIdx),
      kijun: ichimokuAll.kijun.slice(startIdx, endIdx),
      spanA: ichimokuAll.spanA.slice(startIdx, endIdx),
      spanB: ichimokuAll.spanB.slice(startIdx, endIdx),
    }
  }, [ichimokuAll, startIdx, endIdx])

  const bollinger = useMemo(() => {
    if (!bollingerAll) return null
    return {
      upper: bollingerAll.upper.slice(startIdx, endIdx),
      middle: bollingerAll.middle.slice(startIdx, endIdx),
      lower: bollingerAll.lower.slice(startIdx, endIdx),
    }
  }, [bollingerAll, startIdx, endIdx])

  const volumeProfile = useMemo(() => {
    return isMaximized && indicators.showVolumeProfile ? calculateVolumeProfile(visibleBars, 24) : null
  }, [visibleBars, isMaximized, indicators.showVolumeProfile])

  // Layout Geometry (TitanLabs & TradingView Standard Structure)
  const width = 1000
  const height = isMaximized ? 640 : 340
  const padLeft = 8
  const padRight = 68 // Dedicated Y-axis price rail on the right
  const padTop = 16
  const padBottom = 26 // Dedicated X-axis time rail at the bottom
  const plotWidth = width - padLeft - padRight

  const hasRsi = isMaximized && indicators.showRsi
  const hasMacd = isMaximized && indicators.showMacd
  const subpaneCount = (hasRsi ? 1 : 0) + (hasMacd ? 1 : 0)
  const subpaneHeight = 65

  const volHeight = isMaximized ? 55 : 40
  const plotHeight = height - padTop - padBottom - subpaneCount * subpaneHeight
  const mainPriceHeight = plotHeight - volHeight - 12
  const volTop = padTop + mainPriceHeight + 10
  const rsiTop = volTop + volHeight + 8
  const macdTop = hasRsi ? rsiTop + subpaneHeight + 8 : volTop + volHeight + 8

  // Chart metrics based on VISIBLE bars for auto-scaling
  const chartMetrics = useMemo(() => {
    if (visibleBars.length === 0) return null

    let minPrice = Infinity
    let maxPrice = -Infinity
    let maxVol = 0

    visibleBars.forEach((bar) => {
      if (bar.low < minPrice) minPrice = bar.low
      if (bar.high > maxPrice) maxPrice = bar.high
      if (bar.volume > maxVol) maxVol = bar.volume
    })

    if (bollinger) {
      bollinger.upper.forEach((v) => {
        if (v != null && v > maxPrice) maxPrice = v
      })
      bollinger.lower.forEach((v) => {
        if (v != null && v < minPrice) minPrice = v
      })
    }

    const padding = (maxPrice - minPrice) * 0.08 || 1
    const priceRange = maxPrice - minPrice + padding * 2

    return {
      min: minPrice - padding,
      max: maxPrice + padding,
      range: priceRange,
      maxVol: Math.max(maxVol, 1),
    }
  }, [visibleBars, bollinger])

  // Price Grid Levels for Y-Axis (5 clean horizontal levels)
  const priceLevels = useMemo(() => {
    if (!chartMetrics) return []
    const levels: number[] = []
    const count = 5
    for (let i = 0; i <= count; i++) {
      const p = chartMetrics.min + (chartMetrics.range * i) / count
      levels.push(p)
    }
    return levels
  }, [chartMetrics])

  // Time Ticks for X-Axis (evenly distributed according to visible slice)
  const timeTicks = useMemo(() => {
    if (visibleBars.length === 0) return []
    const count = 6
    const step = Math.max(1, Math.floor((visibleBars.length - 1) / count))
    const ticks: { index: number; bar: OhlcvBar; label: string }[] = []
    for (let i = 0; i < visibleBars.length; i += step) {
      const b = visibleBars[i]
      const d = new Date(b.time * 1000)
      let label = ""
      if (timeframe.includes("m") || timeframe.includes("h")) {
        label = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
      } else if (timeframe === "1D" || timeframe === "3D" || timeframe === "1W") {
        label = `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`
      } else {
        label = `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`
      }
      ticks.push({ index: i, bar: b, label })
    }
    return ticks
  }, [visibleBars, timeframe])

  // Coordinate Mapping
  const getX = useCallback(
    (idx: number) => padLeft + (idx / Math.max(1, visibleBars.length - 1)) * plotWidth,
    [padLeft, visibleBars.length, plotWidth],
  )
  const getY = useCallback(
    (price: number) => {
      if (!chartMetrics) return 0
      return padTop + ((chartMetrics.max - price) / chartMetrics.range) * mainPriceHeight
    },
    [chartMetrics, padTop, mainPriceHeight],
  )

  const priceToY = (price: number) => getY(price)
  const yToPrice = (y: number) => {
    if (!chartMetrics) return 0
    return chartMetrics.max - ((y - padTop) / mainPriceHeight) * chartMetrics.range
  }

  const timeToX = (time: number) => {
    if (visibleBars.length === 0) return 0
    if (time < visibleBars[0].time) return -60 // offscreen left
    if (time > visibleBars.at(-1)!.time) return width + 60 // offscreen right

    // Exact or closest interpolation
    for (let i = 0; i < visibleBars.length; i++) {
      if (visibleBars[i].time >= time) {
        if (i === 0 || visibleBars[i].time === time) return getX(i)
        const t0 = visibleBars[i - 1].time
        const t1 = visibleBars[i].time
        const frac = (time - t0) / Math.max(1, t1 - t0)
        return getX(i - 1) + frac * (getX(i) - getX(i - 1))
      }
    }
    return getX(visibleBars.length - 1)
  }

  const xToTime = (x: number) => {
    if (visibleBars.length === 0) return 0
    const ratio = Math.max(0, Math.min(1, (x - padLeft) / plotWidth))
    const idx = Math.round(ratio * (visibleBars.length - 1))
    return visibleBars[idx]?.time || visibleBars.at(-1)?.time || 0
  }

  const makeLinePath = useCallback(
    (series: Array<number | null>) => {
      let path = ""
      series.forEach((val, i) => {
        if (val === null) return
        const x = getX(i)
        const y = getY(val)
        path += path === "" ? `M ${x} ${y}` : ` L ${x} ${y}`
      })
      return path
    },
    [getX, getY],
  )

  const ma20Path = useMemo(() => makeLinePath(ma20), [ma20, makeLinePath])
  const ma50Path = useMemo(() => makeLinePath(ma50), [ma50, makeLinePath])
  const ma200Path = useMemo(() => makeLinePath(ma200), [ma200, makeLinePath])

  // Mouse wheel Zooming (cursor-centered TradingView / TitanLabs mechanics)
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    const container = containerRef.current
    let cursorRatio = 0.5
    if (container) {
      const rect = container.getBoundingClientRect()
      const mouseX = e.clientX - rect.left - (padLeft * rect.width) / width
      const plotPx = (plotWidth * rect.width) / width
      cursorRatio = Math.max(0, Math.min(1, mouseX / Math.max(1, plotPx)))
    }

    const zoomDir = e.deltaY > 0 ? 1 : -1 // wheel down = zoom out; wheel up = zoom in
    const step = Math.max(3, Math.round(visibleBarsCount * 0.12))
    const nextCount = Math.min(Math.max(15, visibleBarsCount + zoomDir * step), displayBars.length)
    const diff = nextCount - visibleBarsCount

    // Keep bar under cursor stable: proportionally adjust scrollOffset
    const offsetDelta = Math.round(diff * (1 - cursorRatio))
    const nextOffset = Math.max(0, Math.min(maxScrollOffset, scrollOffset + offsetDelta))

    setVisibleBarsCount(nextCount)
    setScrollOffset(nextOffset)
  }

  // Mouse Panning & Scrolling
  const handleMouseDownCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === "cursor") {
      isPanningRef.current = true
      panStartXRef.current = e.clientX
      panStartOffsetRef.current = scrollOffset
    }
  }

  const handleMouseMoveCanvas = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()

    if (isPanningRef.current) {
      const dx = e.clientX - panStartXRef.current
      const barPx = Math.max(1, (plotWidth * rect.width) / width / Math.max(1, visibleBarsCount))
      const deltaBars = Math.round(dx / barPx)
      const nextOffset = Math.max(0, Math.min(maxScrollOffset, panStartOffsetRef.current + deltaBars))
      setScrollOffset(nextOffset)
      return
    }

    if (activeTool === "cursor") {
      const relX = e.clientX - rect.left - (padLeft * rect.width) / width
      const effectiveWidth = (plotWidth * rect.width) / width
      const ratio = Math.max(0, Math.min(1, relX / Math.max(1, effectiveWidth)))
      const idx = Math.round(ratio * (visibleBars.length - 1))
      setHoverIndex(idx)

      const relY = e.clientY - rect.top
      const svgY = (relY / Math.max(1, rect.height)) * height
      setHoverY(svgY)
    }
  }

  const handleMouseUpCanvas = () => {
    isPanningRef.current = false
  }

  const handleResetView = () => {
    setScrollOffset(0)
    setVisibleBarsCount(75)
  }

  const activeBar = hoverIndex !== null && visibleBars[hoverIndex] ? visibleBars[hoverIndex] : visibleBars.at(-1)

  if (!displayBars.length || !chartMetrics || visibleBars.length === 0) {
    return (
      <div className="flex h-[310px] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#080d13] p-6 text-sm text-slate-500 font-ticker">
        Đang nạp dữ liệu nến TradingView {ticker}...
      </div>
    )
  }

  const activeIndicatorsCount = Object.values(indicators).filter(Boolean).length
  const editingDrawing = drawings.find((d) => d.id === editingTextDrawingId)

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13] shadow-[0_8px_32px_rgba(0,0,0,0.6)] font-ticker",
        isMaximized ? "h-full min-h-[620px]" : "h-auto",
      )}
    >
      {/* ========================================================================= */}
      {/* TOP CONTROLS & TRADINGVIEW TOOLBAR                                        */}
      {/* ========================================================================= */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/[0.08] bg-[#0a0f16] px-3.5 py-2 text-xs">
        {/* Left Section: Ticker Info & Timeframe Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* In Maximized Mode: Show Ticker badge & Live Price */}
          {isMaximized && (
            <div className="flex items-center gap-2 mr-1">
              <span className="font-ticker text-base font-extrabold text-cyan-300 tracking-tight">{ticker}</span>
              {currentPrice ? (
                <span className="font-mono text-xs font-bold text-white">
                  {currentPrice.toLocaleString("vi-VN")}
                </span>
              ) : null}
              {changePct !== undefined ? (
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[10px] font-bold",
                    changePct >= 0 ? "bg-emerald-400/20 text-emerald-300" : "bg-rose-400/20 text-rose-300",
                  )}
                >
                  {changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`}
                </span>
              ) : null}
              <div className="mx-1 h-3.5 w-px bg-white/[0.1]" />
            </div>
          )}

          {/* Quick Timeframes */}
          <div className="flex items-center gap-1">
            {QUICK_TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={cn(
                  "rounded-md px-2 py-0.5 font-mono text-[11px] font-bold transition-colors",
                  timeframe === tf
                    ? "border border-cyan-400/40 bg-cyan-400/20 text-cyan-200 shadow-[0_0_8px_rgba(0,240,255,0.25)]"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200",
                )}
              >
                {tf}
              </button>
            ))}

            {/* Timeframes Dropdown (All 12 timeframes) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowTfDropdown((prev) => !prev)}
                className={cn(
                  "flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] transition-colors",
                  !QUICK_TIMEFRAMES.includes(timeframe)
                    ? "border border-cyan-400/40 bg-cyan-400/20 text-cyan-200 font-bold shadow-[0_0_8px_rgba(0,240,255,0.25)]"
                    : showTfDropdown
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-white",
                )}
                title="Tất cả các khung thời gian"
              >
                {!QUICK_TIMEFRAMES.includes(timeframe) && <span>{timeframe}</span>}
                <ChevronDown className={cn("size-3 transition-transform duration-150", showTfDropdown && "rotate-180")} />
              </button>

              {showTfDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowTfDropdown(false)}
                  />
                  <div className="absolute left-0 top-8 z-50 w-56 max-h-[420px] overflow-y-auto rounded-xl border border-white/[0.12] bg-[#0c131c] py-1.5 shadow-2xl divide-y divide-white/[0.06]">
                    {["Phút", "Giờ", "Ngày / Tuần", "Tháng / Quý / Năm"].map((grp) => {
                      const items = ALL_TIMEFRAMES.filter((t) => t.group === grp)
                      return (
                        <div key={grp} className="py-1 first:pt-0.5 last:pb-0.5">
                          <span className="block px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">
                            {grp}
                          </span>
                          <div className="flex flex-col space-y-0.5">
                            {items.map((it) => {
                              const isActive = timeframe === it.id
                              return (
                                <button
                                  key={it.id}
                                  type="button"
                                  onClick={() => {
                                    setTimeframe(it.id)
                                    setShowTfDropdown(false)
                                  }}
                                  className={cn(
                                    "w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors group",
                                    isActive
                                      ? "bg-cyan-500/15 text-cyan-300 font-semibold"
                                      : "text-slate-300 hover:bg-white/[0.06] hover:text-white",
                                  )}
                                >
                                  <div className="flex items-center gap-3">
                                    <span
                                      className={cn(
                                        "font-mono text-[11px] font-bold w-8 text-left shrink-0",
                                        isActive
                                          ? "text-cyan-300"
                                          : "text-slate-400 group-hover:text-slate-200",
                                      )}
                                    >
                                      {it.id}
                                    </span>
                                    <span className="text-[12px]">{it.label}</span>
                                  </div>
                                  {isActive && (
                                    <Check className="size-3.5 text-cyan-400 shrink-0" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Maximized: Chart Style Dropdown */}
          {isMaximized && (
            <div className="relative flex items-center ml-1">
              <div className="mx-1 h-3.5 w-px bg-white/[0.1]" />
              <button
                type="button"
                onClick={() => setShowStyleDropdown((prev) => !prev)}
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/[0.05] transition-colors"
              >
                <span>
                  {chartStyle === "candles"
                    ? "Nến Nhật"
                    : chartStyle === "line"
                    ? "Đường Line"
                    : chartStyle === "area"
                    ? "Vùng Area"
                    : "Nến Rỗng"}
                </span>
                <ChevronDown className="size-3 text-slate-400" />
              </button>

              {showStyleDropdown && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowStyleDropdown(false)}
                  />
                  <div className="absolute left-0 top-8 z-50 w-36 rounded-xl border border-white/[0.12] bg-[#0c131c] p-1.5 shadow-2xl">
                    {(["candles", "line", "area", "hollow"] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => {
                          setChartStyle(st)
                          setShowStyleDropdown(false)
                        }}
                        className={cn(
                          "w-full flex items-center justify-between rounded px-2.5 py-1.5 text-left text-[11px] transition-colors",
                          chartStyle === st
                            ? "bg-cyan-500/15 text-cyan-300 font-bold"
                            : "text-slate-400 hover:text-white hover:bg-white/[0.04]",
                        )}
                      >
                        <span>
                          {st === "candles"
                            ? "Nến Nhật"
                            : st === "line"
                            ? "Đường Line"
                            : st === "area"
                            ? "Vùng Area"
                            : "Nến Rỗng"}
                        </span>
                        {chartStyle === st && <Check className="size-3.5 text-cyan-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Maximized: Indicators Popover Button */}
          {isMaximized && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowIndicatorModal((prev) => !prev)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-[11px] font-semibold transition-colors border",
                  activeIndicatorsCount > 0
                    ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200"
                    : "border-white/[0.08] text-slate-300 hover:bg-white/[0.06]",
                )}
              >
                <SlidersHorizontal className="size-3" />
                <span>Chỉ báo</span>
                {activeIndicatorsCount > 0 && (
                  <span className="size-4 rounded-full bg-cyan-400 text-[10px] font-bold text-black flex items-center justify-center">
                    {activeIndicatorsCount}
                  </span>
                )}
              </button>

              {showIndicatorModal && (
                <StockChartIndicatorModal
                  config={indicators}
                  onChange={setIndicators}
                  onClose={() => setShowIndicatorModal(false)}
                />
              )}
            </div>
          )}
        </div>

        {/* Right Section: OHLCV Readout, Zoom/Pan Reset & Maximize/Minimize */}
        <div className="flex items-center gap-3">
          {/* OHLCV live readout */}
          {activeBar && (
            <div className="hidden sm:flex flex-wrap items-center gap-2 font-mono text-[10px] text-slate-400">
              <span className="text-slate-500">
                {new Date(activeBar.time * 1000).toLocaleDateString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
              <span>O: <b className="text-slate-200">{activeBar.open.toLocaleString()}</b></span>
              <span>H: <b className="text-emerald-300">{activeBar.high.toLocaleString()}</b></span>
              <span>L: <b className="text-rose-300">{activeBar.low.toLocaleString()}</b></span>
              <span>
                C:{" "}
                <b className={activeBar.close >= activeBar.open ? "text-emerald-300" : "text-rose-300"}>
                  {activeBar.close.toLocaleString()}
                </b>
              </span>
              <span>V: <b className="text-slate-200">{(activeBar.volume / 1_000_000).toFixed(2)}M</b></span>
            </div>
          )}

          {/* Action Buttons: Reset View, Screenshot, Maximize/Minimize */}
          <div className="flex items-center gap-1">
            {isMaximized && (
              <>
                <button
                  type="button"
                  title="Đặt lại góc nhìn (Reset View & Zoom)"
                  onClick={handleResetView}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  type="button"
                  title="Chụp ảnh biểu đồ"
                  onClick={() => alert("Tính năng chụp biểu đồ đã sẵn sàng")}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
                >
                  <Camera className="size-3.5" />
                </button>
              </>
            )}

            {onToggleMaximize && (
              <button
                type="button"
                onClick={onToggleMaximize}
                title={isMaximized ? "Thu nhỏ chart" : "Phóng to chart"}
                className={cn(
                  "flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold font-mono transition-all border",
                  isMaximized
                    ? "border-amber-400/40 bg-amber-400/20 text-amber-300 hover:bg-amber-400/30"
                    : "border-cyan-400/30 bg-cyan-400/10 text-cyan-300 hover:bg-cyan-400/20 shadow-[0_0_12px_rgba(0,240,255,0.2)]",
                )}
              >
                {isMaximized ? (
                  <>
                    <Minimize2 className="size-3.5" />
                    <span>Thu nhỏ</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="size-3.5" />
                    <span>Phóng to</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* CHART MAIN CANVAS & DRAWING SUITE (SCROLL & ZOOMABLE)                     */}
      {/* ========================================================================= */}
      <div
        ref={containerRef}
        className={cn(
          "relative w-full flex-1 select-none overflow-hidden",
          isMaximized ? "min-h-[560px]" : "min-h-[280px]",
          activeTool === "cursor" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair",
        )}
        onWheel={handleWheel}
        onMouseDown={handleMouseDownCanvas}
        onMouseMove={handleMouseMoveCanvas}
        onMouseUp={handleMouseUpCanvas}
        onMouseLeave={() => {
          isPanningRef.current = false
          setHoverIndex(null)
          setHoverY(null)
        }}
      >
        {/* Floating Drawing Toolbar on the Left (Only in Maximized Mode) */}
        {isMaximized && (
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
            onToggleLock={() => setIsDrawingsLocked((p) => !p)}
            isHidden={isDrawingsHidden}
            onToggleHide={() => setIsDrawingsHidden((p) => !p)}
            onClearAll={clearAllDrawings}
            onToggleObjectManager={() => setIsObjectManagerOpen((prev) => !prev)}
            isObjectManagerOpen={isObjectManagerOpen}
            drawingsCount={drawings.length}
            saveStatus={saveStatus}
          />
        )}

        {/* Object Management Panel (Object Tree / Layers) */}
        {isMaximized && isObjectManagerOpen && (
          <StockChartObjectManager
            drawings={drawings}
            selectedId={selectedDrawingId}
            onSelect={(id) => setSelectedDrawingId(id)}
            onToggleHide={(id) => {
              const target = drawings.find((d) => d.id === id)
              if (target) modifyDrawing(id, { hidden: !target.hidden })
            }}
            onToggleLock={(id) => {
              const target = drawings.find((d) => d.id === id)
              if (target) modifyDrawing(id, { locked: !target.locked })
            }}
            onDelete={(id) => {
              deleteDrawing(id)
              if (selectedDrawingId === id) setSelectedDrawingId(null)
            }}
            onEditText={(id) => setEditingTextDrawingId(id)}
            onClearAll={clearAllDrawings}
            onClose={() => setIsObjectManagerOpen(false)}
          />
        )}

        {/* Text Edit Modal / Popover */}
        {editingDrawing && editingDrawing.tool === "text" && (
          <StockChartTextEditor
            initialText={editingDrawing.text || ""}
            initialColor={editingDrawing.color}
            initialFontSize={editingDrawing.fontSize || 13}
            position={{
              x: timeToX(editingDrawing.points[0]?.time || 0) || editingDrawing.points[0]?.x || width / 2,
              y: priceToY(editingDrawing.points[0]?.price || 0) || editingDrawing.points[0]?.y || height / 2,
            }}
            containerWidth={width}
            containerHeight={height}
            onSave={(newText, newColor, newFontSize) => {
              modifyDrawing(editingDrawing.id, {
                text: newText,
                color: newColor,
                fontSize: newFontSize,
              })
              setEditingTextDrawingId(null)
            }}
            onCancel={() => setEditingTextDrawingId(null)}
          />
        )}

        {/* Primary SVG Chart */}
        <svg viewBox={`0 0 ${width} ${height}`} className="size-full" preserveAspectRatio="none">
          {/* Right Y-Axis Price Rail Background */}
          <rect
            x={width - padRight}
            y={0}
            width={padRight}
            height={height - padBottom}
            fill="#090d14"
          />
          <line
            x1={width - padRight}
            y1={0}
            x2={width - padRight}
            y2={height - padBottom}
            stroke="#1c2836"
            strokeWidth="1"
          />

          {/* Bottom X-Axis Time Rail Background */}
          <rect
            x={0}
            y={height - padBottom}
            width={width}
            height={padBottom}
            fill="#090d14"
          />
          <line
            x1={0}
            y1={height - padBottom}
            x2={width}
            y2={height - padBottom}
            stroke="#1c2836"
            strokeWidth="1"
          />

          {/* Corner Junction */}
          <rect
            x={width - padRight}
            y={height - padBottom}
            width={padRight}
            height={padBottom}
            fill="#06090f"
          />

          {/* Y-Axis Price Grid Lines & Labels */}
          {priceLevels.map((p, idx) => {
            const y = getY(p)
            if (y < padTop || y > padTop + mainPriceHeight) return null
            return (
              <g key={`pl-${idx}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#182330"
                  strokeDasharray="3 3"
                  opacity="0.65"
                />
                <line
                  x1={width - padRight}
                  y1={y}
                  x2={width - padRight + 4}
                  y2={y}
                  stroke="#334155"
                />
                <text
                  x={width - padRight + 7}
                  y={y + 3.5}
                  fill="#788b9c"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {p.toFixed(1)}
                </text>
              </g>
            )
          })}

          {/* X-Axis Time Grid Lines, Ticks & Labels */}
          {timeTicks.map((t) => {
            const x = getX(t.index)
            return (
              <g key={`tt-${t.index}`}>
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={height - padBottom}
                  stroke="#141f2d"
                  strokeDasharray="3 3"
                  opacity="0.5"
                />
                <line
                  x1={x}
                  y1={height - padBottom}
                  x2={x}
                  y2={height - padBottom + 4}
                  stroke="#334155"
                />
                <text
                  x={x}
                  y={height - padBottom + 16}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {t.label}
                </text>
              </g>
            )
          })}

          {/* Volume Baseline & Label */}
          <line
            x1={padLeft}
            y1={volTop + volHeight}
            x2={width - padRight}
            y2={volTop + volHeight}
            stroke="#1c2836"
            opacity="0.9"
          />
          <text
            x={width - padRight + 7}
            y={volTop + volHeight}
            fill="#62727d"
            fontSize="9"
            fontFamily="monospace"
          >
            Vol
          </text>

          {/* 1. Volume Profile Bars (POC) on Price Chart (if enabled) */}
          {volumeProfile && (
            <g opacity="0.65">
              {volumeProfile.buckets.map((b, idx) => {
                const bY = getY(b.price)
                const barLen = (b.volume / volumeProfile.maxBucketVol) * (plotWidth * 0.22)
                const isPoc = b.isPoc
                return (
                  <g key={`vp-${idx}`}>
                    <rect
                      x={width - padRight - barLen}
                      y={bY - 4}
                      width={barLen}
                      height={8}
                      fill={isPoc ? "#f43f5e" : "#3b82f6"}
                      fillOpacity={isPoc ? 0.45 : 0.2}
                      stroke={isPoc ? "#f43f5e" : "none"}
                      strokeWidth={1}
                    />
                    {isPoc && (
                      <line
                        x1={padLeft}
                        y1={bY}
                        x2={width - padRight}
                        y2={bY}
                        stroke="#f43f5e"
                        strokeWidth="1.5"
                        strokeDasharray="4 2"
                      />
                    )}
                  </g>
                )
              })}
            </g>
          )}

          {/* 2. Ichimoku Cloud (if enabled) */}
          {ichimoku && (
            <g opacity="0.35">
              {visibleBars.map((_, i) => {
                if (i === 0) return null
                const spanA1 = ichimoku.spanA[i - 1]
                const spanB1 = ichimoku.spanB[i - 1]
                const spanA2 = ichimoku.spanA[i]
                const spanB2 = ichimoku.spanB[i]
                if (spanA1 == null || spanB1 == null || spanA2 == null || spanB2 == null) return null

                const x1 = getX(i - 1)
                const x2 = getX(i)
                const yA1 = getY(spanA1)
                const yB1 = getY(spanB1)
                const yA2 = getY(spanA2)
                const yB2 = getY(spanB2)
                const isBull = spanA2 >= spanB2
                const cloudPoints = `${x1},${yA1} ${x2},${yA2} ${x2},${yB2} ${x1},${yB1}`
                return (
                  <polygon
                    key={`kumo-${i}`}
                    points={cloudPoints}
                    fill={isBull ? "#10b981" : "#f43f5e"}
                    fillOpacity="0.25"
                  />
                )
              })}
            </g>
          )}

          {/* 3. Bollinger Bands Shaded Area (if enabled) */}
          {bollinger && (
            <g opacity="0.25">
              {visibleBars.map((_, i) => {
                if (i === 0) return null
                const u1 = bollinger.upper[i - 1]
                const l1 = bollinger.lower[i - 1]
                const u2 = bollinger.upper[i]
                const l2 = bollinger.lower[i]
                if (u1 == null || l1 == null || u2 == null || l2 == null) return null

                const x1 = getX(i - 1)
                const x2 = getX(i)
                const points = `${x1},${getY(u1)} ${x2},${getY(u2)} ${x2},${getY(l2)} ${x1},${getY(l1)}`
                return <polygon key={`bb-${i}`} points={points} fill="#38bdf8" fillOpacity="0.15" />
              })}
            </g>
          )}

          {/* 4. Volume Bars (Standard Volume Pane) */}
          {visibleBars.map((bar, i) => {
            const x = getX(i)
            const vH = (bar.volume / chartMetrics.maxVol) * volHeight
            const isBull = bar.close >= bar.open
            const barW = Math.max(2, plotWidth / visibleBars.length - 1.5)
            return (
              <rect
                key={`v-${bar.time}-${i}`}
                x={x - barW / 2}
                y={volTop + volHeight - vH}
                width={barW}
                height={vH}
                fill={isBull ? "#10b981" : "#f43f5e"}
                opacity="0.35"
                rx="0.5"
              />
            )
          })}

          {/* 5. Main Candlesticks / Line Chart */}
          {chartStyle === "candles" || chartStyle === "hollow" ? (
            visibleBars.map((bar, i) => {
              const x = getX(i)
              const isBull = bar.close >= bar.open
              const color = isBull ? "#10b981" : "#f43f5e"
              const highY = getY(bar.high)
              const lowY = getY(bar.low)
              const openY = getY(bar.open)
              const closeY = getY(bar.close)
              const bodyTop = Math.min(openY, closeY)
              const bodyHeight = Math.max(1.5, Math.abs(closeY - openY))
              const candleW = Math.max(2, plotWidth / visibleBars.length - 2)

              return (
                <g key={`c-${bar.time}-${i}`}>
                  <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.2" />
                  <rect
                    x={x - candleW / 2}
                    y={bodyTop}
                    width={candleW}
                    height={bodyHeight}
                    fill={chartStyle === "hollow" && isBull ? "none" : color}
                    stroke={color}
                    strokeWidth={chartStyle === "hollow" ? 1.2 : 0}
                    rx="1"
                  />
                </g>
              )
            })
          ) : (
            // Line or Area Chart
            <g>
              <path
                d={makeLinePath(visibleBars.map((b) => b.close))}
                fill="none"
                stroke="#00f0ff"
                strokeWidth="2"
              />
              {chartStyle === "area" && (
                <path
                  d={`${makeLinePath(visibleBars.map((b) => b.close))} L ${width - padRight} ${padTop + mainPriceHeight} L ${padLeft} ${padTop + mainPriceHeight} Z`}
                  fill="url(#area-gradient)"
                  opacity="0.3"
                />
              )}
            </g>
          )}

          {/* Moving Averages (only if MA indicator enabled) */}
          {(isMaximized ? indicators.showMa : false) && (
            <>
              <path d={ma20Path} fill="none" stroke="#10b981" strokeWidth="1.6" opacity="0.85" />
              <path d={ma50Path} fill="none" stroke="#f59e0b" strokeWidth="1.6" opacity="0.75" />
              <path d={ma200Path} fill="none" stroke="#a855f7" strokeWidth="1.6" opacity="0.75" />
            </>
          )}

          {/* Current Price Dashed Line & Badge on Y-Axis */}
          {activeBar && (
            <g>
              <line
                x1={padLeft}
                y1={getY(activeBar.close)}
                x2={width - padRight}
                y2={getY(activeBar.close)}
                stroke={activeBar.close >= activeBar.open ? "#10b981" : "#f43f5e"}
                strokeDasharray="4 2"
                strokeWidth="1"
                opacity="0.9"
              />
              <rect
                x={width - padRight + 1}
                y={getY(activeBar.close) - 8.5}
                width={padRight - 2}
                height={17}
                fill={activeBar.close >= activeBar.open ? "#10b981" : "#f43f5e"}
                rx="2"
              />
              <text
                x={width - padRight + 6}
                y={getY(activeBar.close) + 3.5}
                fill="#ffffff"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {activeBar.close.toFixed(1)}
              </text>
            </g>
          )}

          {/* Crosshair indicator with X-axis and Y-axis tracking */}
          {hoverIndex !== null && visibleBars[hoverIndex] && (
            <g>
              {/* Vertical crosshair line */}
              <line
                x1={getX(hoverIndex)}
                y1={padTop}
                x2={getX(hoverIndex)}
                y2={height - padBottom}
                stroke="#00f0ff"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.75"
              />

              {/* Horizontal crosshair line & Y-axis Price Badge */}
              {hoverY !== null && hoverY >= padTop && hoverY <= height - padBottom && (
                <>
                  <line
                    x1={padLeft}
                    y1={hoverY}
                    x2={width - padRight}
                    y2={hoverY}
                    stroke="#00f0ff"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                    opacity="0.75"
                  />
                  <rect
                    x={width - padRight + 1}
                    y={hoverY - 8.5}
                    width={padRight - 2}
                    height={17}
                    fill="#182330"
                    stroke="#00f0ff"
                    strokeWidth="1"
                    rx="2"
                  />
                  <text
                    x={width - padRight + 6}
                    y={hoverY + 3.5}
                    fill="#00f0ff"
                    fontSize="10"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    {yToPrice(hoverY).toFixed(1)}
                  </text>
                </>
              )}

              {/* X-axis Date/Time Badge */}
              {(() => {
                const hBar = visibleBars[hoverIndex]
                const d = new Date(hBar.time * 1000)
                const dateStr =
                  timeframe.includes("m") || timeframe.includes("h")
                    ? `${d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })} ${d.getDate()}/${d.getMonth() + 1}`
                    : `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getFullYear()}`
                const hX = getX(hoverIndex)
                const pillW = 85
                const pillX = Math.max(padLeft, Math.min(width - padRight - pillW, hX - pillW / 2))
                return (
                  <g>
                    <rect
                      x={pillX}
                      y={height - padBottom + 3}
                      width={pillW}
                      height={18}
                      fill="#182330"
                      stroke="#00f0ff"
                      strokeWidth="1"
                      rx="2"
                    />
                    <text
                      x={pillX + pillW / 2}
                      y={height - padBottom + 15}
                      textAnchor="middle"
                      fill="#00f0ff"
                      fontSize="9"
                      fontWeight="bold"
                      fontFamily="monospace"
                    >
                      {dateStr}
                    </text>
                  </g>
                )
              })()}
            </g>
          )}

          {/* 6. RSI Subpane (if enabled in Maximized mode) */}
          {hasRsi && (
            <g>
              {/* RSI Boundaries */}
              <line x1={padLeft} y1={rsiTop} x2={width - padRight} y2={rsiTop} stroke="#334155" strokeDasharray="2 2" opacity="0.5" />
              <line x1={padLeft} y1={rsiTop + subpaneHeight * 0.3} x2={width - padRight} y2={rsiTop + subpaneHeight * 0.3} stroke="#7c3aed" strokeDasharray="3 3" opacity="0.6" />
              <line x1={padLeft} y1={rsiTop + subpaneHeight * 0.7} x2={width - padRight} y2={rsiTop + subpaneHeight * 0.7} stroke="#7c3aed" strokeDasharray="3 3" opacity="0.6" />
              <line x1={padLeft} y1={rsiTop + subpaneHeight} x2={width - padRight} y2={rsiTop + subpaneHeight} stroke="#334155" strokeDasharray="2 2" opacity="0.5" />

              {/* RSI Curve */}
              {(() => {
                let rsiPath = ""
                rsiSeries.forEach((val, i) => {
                  if (val == null) return
                  const x = getX(i)
                  const y = rsiTop + ((100 - val) / 100) * subpaneHeight
                  rsiPath += rsiPath === "" ? `M ${x} ${y}` : ` L ${x} ${y}`
                })
                return <path d={rsiPath} fill="none" stroke="#a855f7" strokeWidth="1.8" />
              })()}

              <text x={padLeft + 8} y={rsiTop + 12} fill="#c084fc" fontSize="10" fontFamily="monospace" fontWeight="bold">
                RSI (14): {rsiSeries.at(-1)?.toFixed(1) || "—"}
              </text>
              <text x={width - padRight + 8} y={rsiTop + subpaneHeight * 0.3 + 3} fill="#94a3b8" fontSize="8" fontFamily="monospace">
                70
              </text>
              <text x={width - padRight + 8} y={rsiTop + subpaneHeight * 0.7 + 3} fill="#94a3b8" fontSize="8" fontFamily="monospace">
                30
              </text>
            </g>
          )}

          {/* 7. MACD Subpane (if enabled in Maximized mode) */}
          {hasMacd && macdSeries && (
            <g>
              <line x1={padLeft} y1={macdTop + subpaneHeight / 2} x2={width - padRight} y2={macdTop + subpaneHeight / 2} stroke="#334155" opacity="0.8" />

              {/* MACD Histogram */}
              {macdSeries.histogram.map((val, i) => {
                if (val == null) return null
                const x = getX(i)
                const zeroY = macdTop + subpaneHeight / 2
                const barH = Math.min(subpaneHeight / 2, Math.abs(val) * 10)
                const isBull = val >= 0
                return (
                  <rect
                    key={`macd-hist-${i}`}
                    x={x - 1.5}
                    y={isBull ? zeroY - barH : zeroY}
                    width={3}
                    height={barH}
                    fill={isBull ? "#10b981" : "#f43f5e"}
                    opacity="0.6"
                  />
                )
              })}

              <text x={padLeft + 8} y={macdTop + 12} fill="#38bdf8" fontSize="10" fontFamily="monospace" fontWeight="bold">
                MACD (12, 26, 9)
              </text>
            </g>
          )}

          {/* Price Axis Double-click Reset Trigger */}
          <rect
            x={width - padRight}
            y={0}
            width={padRight}
            height={height}
            fill="transparent"
            className="cursor-pointer"
            onDoubleClick={handleResetView}
          >
            <title>Nhấn đúp để đặt lại tỷ lệ giá (Reset Auto Scale)</title>
          </rect>

          {/* Area gradient definition */}
          <defs>
            <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Interactive Drawing Canvas Layer with Handles, Coordinates & Selection */}
        {isMaximized && (
          <StockChartDrawingCanvas
            width={width}
            height={height}
            drawings={drawings}
            selectedId={selectedDrawingId}
            onSelectDrawing={(id) => setSelectedDrawingId(id)}
            onAddDrawing={addDrawing}
            onUpdateDrawing={modifyDrawing}
            onDeleteDrawing={deleteDrawing}
            onEditText={(id) => setEditingTextDrawingId(id)}
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
          />
        )}
      </div>

      {/* TitanLabs / TradingView Range Bar & Navigation Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-t border-white/[0.08] bg-[#070b10] px-3 py-1.5 text-[11px] font-mono select-none">
        {/* Time Range Presets */}
        <div className="flex items-center gap-1">
          {[
            { label: "1T", bars: 22, title: "1 tháng gần nhất" },
            { label: "3T", bars: 66, title: "3 tháng gần nhất" },
            { label: "6T", bars: 130, title: "6 tháng gần nhất" },
            { label: "1N", bars: 250, title: "1 năm gần nhất" },
            { label: "Tất cả", bars: displayBars.length, title: "Toàn bộ lịch sử" },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              title={preset.title}
              onClick={() => {
                setScrollOffset(0)
                setVisibleBarsCount(Math.min(displayBars.length, Math.max(15, preset.bars)))
              }}
              className={cn(
                "rounded px-2 py-0.5 font-bold transition-colors",
                scrollOffset === 0 && Math.abs(visibleBarsCount - preset.bars) <= 5
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* Right Controls: Auto-scale and status */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            title="Tự căn khung nhìn vừa dữ liệu (Auto Fit)"
            onClick={handleResetView}
            className="rounded px-2 py-0.5 font-bold text-slate-400 hover:bg-white/[0.06] hover:text-cyan-300 transition-colors"
          >
            Tự động
          </button>
          <span className="hidden sm:inline text-[10px] text-slate-500">
            {visibleBars.length} nến · Lăn chuột để zoom · Kéo rê để cuộn
          </span>
        </div>
      </div>
    </div>
  )
}
