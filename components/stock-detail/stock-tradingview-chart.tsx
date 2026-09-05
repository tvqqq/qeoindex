"use client"

import React, { useMemo, useState } from "react"
import {
  Camera,
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
  type ChartStyle,
  type ChartTimeframe,
  type DrawingIconType,
  type DrawingObject,
  type DrawingTool,
  type IndicatorConfig,
} from "./chart/stock-chart-types"

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
  // Chart view configuration
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D")
  const [showTfDropdown, setShowTfDropdown] = useState(false)
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles")
  const [showStyleDropdown, setShowStyleDropdown] = useState(false)

  // Indicator modal state
  const [indicators, setIndicators] = useState<IndicatorConfig>(DEFAULT_INDICATOR_CONFIG)
  const [showIndicatorModal, setShowIndicatorModal] = useState(false)

  // Drawing tools state
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor")
  const [activeColor, setActiveColor] = useState<string>("#00f0ff")
  const [lineWidth, setLineWidth] = useState<number>(2)
  const [selectedIconType, setSelectedIconType] = useState<DrawingIconType>("flag")
  const [drawings, setDrawings] = useState<DrawingObject[]>([])
  const [isDrawingsLocked, setIsDrawingsLocked] = useState(false)
  const [isDrawingsHidden, setIsDrawingsHidden] = useState(false)

  // Hover state
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Aggregated bars based on selected timeframe
  const displayBars = useMemo(() => {
    return aggregateBarsByTimeframe(bars, hourlyBars, timeframe)
  }, [bars, hourlyBars, timeframe])

  // Technical Indicators calculations
  const ma20 = useMemo(() => calculateSma(displayBars, 20), [displayBars])
  const ma50 = useMemo(() => calculateSma(displayBars, 50), [displayBars])
  const ma200 = useMemo(() => calculateSma(displayBars, 200), [displayBars])

  const rsiSeries = useMemo(() => {
    return isMaximized && indicators.showRsi ? calculateRsiSeries(displayBars, 14) : []
  }, [displayBars, isMaximized, indicators.showRsi])

  const macdSeries = useMemo(() => {
    return isMaximized && indicators.showMacd ? calculateMacdSeries(displayBars) : null
  }, [displayBars, isMaximized, indicators.showMacd])

  const ichimoku = useMemo(() => {
    return isMaximized && indicators.showIchimoku ? calculateIchimokuSeries(displayBars) : null
  }, [displayBars, isMaximized, indicators.showIchimoku])

  const bollinger = useMemo(() => {
    return isMaximized && indicators.showBollinger ? calculateBollingerBands(displayBars, 20, 2) : null
  }, [displayBars, isMaximized, indicators.showBollinger])

  const volumeProfile = useMemo(() => {
    return isMaximized && indicators.showVolumeProfile ? calculateVolumeProfile(displayBars, 24) : null
  }, [displayBars, isMaximized, indicators.showVolumeProfile])

  // Calculate layout geometry
  const width = 1000
  const height = isMaximized ? 640 : 310
  const padLeft = 20
  const padRight = 65
  const padTop = 20
  const plotWidth = width - padLeft - padRight

  // Pane heights depending on active indicators
  const hasRsi = isMaximized && indicators.showRsi
  const hasMacd = isMaximized && indicators.showMacd
  const subpaneCount = (hasRsi ? 1 : 0) + (hasMacd ? 1 : 0)
  const subpaneHeight = 65

  const volHeight = isMaximized ? 60 : 45
  const mainPriceHeight = height - padTop - volHeight - 25 - subpaneCount * subpaneHeight
  const volTop = padTop + mainPriceHeight + 10
  const rsiTop = volTop + volHeight + 10
  const macdTop = (hasRsi ? rsiTop + subpaneHeight + 10 : volTop + volHeight + 10)

  // Chart metrics for price scaling
  const chartMetrics = useMemo(() => {
    if (displayBars.length === 0) return null

    let minPrice = Infinity
    let maxPrice = -Infinity
    let maxVol = 0

    displayBars.forEach((bar) => {
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
  }, [displayBars, bollinger])

  const activeBar = hoverIndex !== null && displayBars[hoverIndex] ? displayBars[hoverIndex] : displayBars.at(-1)

  const getX = (idx: number) => padLeft + (idx / Math.max(1, displayBars.length - 1)) * plotWidth
  const getY = (price: number) => {
    if (!chartMetrics) return 0
    return padTop + ((chartMetrics.max - price) / chartMetrics.range) * mainPriceHeight
  }

  const makeLinePath = (series: Array<number | null>) => {
    let path = ""
    series.forEach((val, i) => {
      if (val === null) return
      const x = getX(i)
      const y = getY(val)
      path += path === "" ? `M ${x} ${y}` : ` L ${x} ${y}`
    })
    return path
  }

  const ma20Path = useMemo(() => makeLinePath(ma20), [ma20, chartMetrics])
  const ma50Path = useMemo(() => makeLinePath(ma50), [ma50, chartMetrics])
  const ma200Path = useMemo(() => makeLinePath(ma200), [ma200, chartMetrics])

  if (!displayBars.length || !chartMetrics) {
    return (
      <div className="flex h-[310px] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#080d13] p-6 text-sm text-slate-500">
        Đang nạp dữ liệu nến TradingView {ticker}...
      </div>
    )
  }

  const activeIndicatorsCount = Object.values(indicators).filter(Boolean).length

  return (
    <div
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13] shadow-[0_8px_32px_rgba(0,0,0,0.6)]",
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
                className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-slate-400 hover:bg-white/[0.05] hover:text-white transition-colors"
                title="Tất cả các khung thời gian"
              >
                <span>{!QUICK_TIMEFRAMES.includes(timeframe) ? timeframe : ""}</span>
                <ChevronDown className="size-3" />
              </button>

              {showTfDropdown && (
                <div className="absolute left-0 top-8 z-50 w-44 rounded-xl border border-white/[0.1] bg-[#0c131c] p-2 shadow-2xl backdrop-blur-xl">
                  {["Phút", "Giờ", "Ngày / Tuần", "Tháng / Quý / Năm"].map((grp) => {
                    const items = ALL_TIMEFRAMES.filter((t) => t.group === grp)
                    return (
                      <div key={grp} className="mb-2 last:mb-0">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block px-1.5 mb-1 font-mono">
                          {grp}
                        </span>
                        <div className="grid grid-cols-2 gap-1">
                          {items.map((it) => (
                            <button
                              key={it.id}
                              type="button"
                              onClick={() => {
                                setTimeframe(it.id)
                                setShowTfDropdown(false)
                              }}
                              className={cn(
                                "flex items-center justify-between rounded px-2 py-1 text-left font-mono text-[11px] font-semibold transition-colors",
                                timeframe === it.id
                                  ? "bg-cyan-400/20 text-cyan-300 font-bold"
                                  : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
                              )}
                            >
                              <span>{it.id}</span>
                              <span className="text-[10px] text-slate-500">{it.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
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
                <span>{chartStyle === "candles" ? "Nến Nhật" : chartStyle === "line" ? "Đường Line" : chartStyle === "area" ? "Vùng Area" : "Nến Rỗng"}</span>
                <ChevronDown className="size-3 text-slate-400" />
              </button>

              {showStyleDropdown && (
                <div className="absolute left-0 top-8 z-50 w-32 rounded-xl border border-white/[0.1] bg-[#0c131c] p-1.5 shadow-2xl">
                  {(["candles", "line", "area", "hollow"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => {
                        setChartStyle(st)
                        setShowStyleDropdown(false)
                      }}
                      className={cn(
                        "w-full rounded px-2.5 py-1 text-left text-[11px] transition-colors",
                        chartStyle === st ? "bg-cyan-400/20 text-cyan-300 font-bold" : "text-slate-400 hover:text-white hover:bg-white/[0.04]",
                      )}
                    >
                      {st === "candles" ? "Nến Nhật" : st === "line" ? "Đường Line" : st === "area" ? "Vùng Area" : "Nến Rỗng"}
                    </button>
                  ))}
                </div>
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

        {/* Right Section: OHLCV Readout & Maximize / Minimize Button */}
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
              <span>C: <b className={activeBar.close >= activeBar.open ? "text-emerald-300" : "text-rose-300"}>{activeBar.close.toLocaleString()}</b></span>
              <span>V: <b className="text-slate-200">{(activeBar.volume / 1_000_000).toFixed(2)}M</b></span>
            </div>
          )}

          {/* Action Buttons: Screenshot, Reset, Maximize/Minimize */}
          <div className="flex items-center gap-1">
            {isMaximized && (
              <>
                <button
                  type="button"
                  title="Đặt lại góc nhìn"
                  onClick={() => {
                    setTimeframe("1D")
                    setIndicators(DEFAULT_INDICATOR_CONFIG)
                    setDrawings([])
                  }}
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
      {/* CHART MAIN CANVAS & DRAWING SUITE                                         */}
      {/* ========================================================================= */}
      <div
        className={cn(
          "relative w-full flex-1 cursor-crosshair select-none",
          isMaximized ? "min-h-[560px]" : "min-h-[260px]",
        )}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          if (activeTool !== "cursor") return
          const rect = e.currentTarget.getBoundingClientRect()
          const relX = e.clientX - rect.left - (padLeft * rect.width) / width
          const effectiveWidth = (plotWidth * rect.width) / width
          const ratio = Math.max(0, Math.min(1, relX / effectiveWidth))
          const idx = Math.round(ratio * (displayBars.length - 1))
          setHoverIndex(idx)
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
            onClearAll={() => setDrawings([])}
          />
        )}

        {/* Primary SVG Chart */}
        <svg viewBox={`0 0 ${width} ${height}`} className="size-full" preserveAspectRatio="none">
          {/* Horizontal Grid lines */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#182330" strokeDasharray="3 3" opacity="0.6" />
          <line x1={padLeft} y1={padTop + mainPriceHeight * 0.33} x2={width - padRight} y2={padTop + mainPriceHeight * 0.33} stroke="#182330" strokeDasharray="3 3" opacity="0.6" />
          <line x1={padLeft} y1={padTop + mainPriceHeight * 0.66} x2={width - padRight} y2={padTop + mainPriceHeight * 0.66} stroke="#182330" strokeDasharray="3 3" opacity="0.6" />
          <line x1={padLeft} y1={padTop + mainPriceHeight} x2={width - padRight} y2={padTop + mainPriceHeight} stroke="#182330" opacity="0.8" />

          {/* Volume Baseline */}
          <line x1={padLeft} y1={volTop + volHeight} x2={width - padRight} y2={volTop + volHeight} stroke="#182330" opacity="0.8" />

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
              {displayBars.map((_, i) => {
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
              {displayBars.map((_, i) => {
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
          {displayBars.map((bar, i) => {
            const x = getX(i)
            const vH = (bar.volume / chartMetrics.maxVol) * volHeight
            const isBull = bar.close >= bar.open
            const barW = Math.max(2, plotWidth / displayBars.length - 1.5)
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
            displayBars.map((bar, i) => {
              const x = getX(i)
              const isBull = bar.close >= bar.open
              const color = isBull ? "#10b981" : "#f43f5e"
              const highY = getY(bar.high)
              const lowY = getY(bar.low)
              const openY = getY(bar.open)
              const closeY = getY(bar.close)
              const bodyTop = Math.min(openY, closeY)
              const bodyHeight = Math.max(1.5, Math.abs(closeY - openY))
              const candleW = Math.max(3, plotWidth / displayBars.length - 2)

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
                d={makeLinePath(displayBars.map((b) => b.close))}
                fill="none"
                stroke="#00f0ff"
                strokeWidth="2"
              />
              {chartStyle === "area" && (
                <path
                  d={`${makeLinePath(displayBars.map((b) => b.close))} L ${width - padRight} ${padTop + mainPriceHeight} L ${padLeft} ${padTop + mainPriceHeight} Z`}
                  fill="url(#area-gradient)"
                  opacity="0.3"
                />
              )}
            </g>
          )}

          {/* Moving Averages (only if MA indicator enabled or standard mode) */}
          {(isMaximized ? indicators.showMa : false) && (
            <>
              <path d={ma20Path} fill="none" stroke="#10b981" strokeWidth="1.6" opacity="0.85" />
              <path d={ma50Path} fill="none" stroke="#f59e0b" strokeWidth="1.6" opacity="0.75" />
              <path d={ma200Path} fill="none" stroke="#a855f7" strokeWidth="1.6" opacity="0.75" />
            </>
          )}

          {/* Current Price Dashed Line */}
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
                opacity="0.8"
              />
              <rect
                x={width - padRight + 2}
                y={getY(activeBar.close) - 8}
                width={56}
                height={16}
                fill={activeBar.close >= activeBar.open ? "#10b981" : "#f43f5e"}
                rx="3"
              />
              <text
                x={width - padRight + 6}
                y={getY(activeBar.close) + 4}
                fill="#ffffff"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                {activeBar.close.toFixed(1)}
              </text>
            </g>
          )}

          {/* Crosshair indicator */}
          {hoverIndex !== null && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={padTop}
                x2={getX(hoverIndex)}
                y2={height - 10}
                stroke="#00f0ff"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
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

          {/* Price Axis Labels on the right */}
          <text x={width - padRight + 8} y={padTop + 6} fill="#8a9ba7" fontSize="10" fontFamily="monospace">
            {chartMetrics.max.toFixed(1)}
          </text>
          <text x={width - padRight + 8} y={padTop + mainPriceHeight * 0.5 + 4} fill="#8a9ba7" fontSize="10" fontFamily="monospace">
            {(chartMetrics.min + chartMetrics.range * 0.5).toFixed(1)}
          </text>
          <text x={width - padRight + 8} y={padTop + mainPriceHeight + 4} fill="#8a9ba7" fontSize="10" fontFamily="monospace">
            {chartMetrics.min.toFixed(1)}
          </text>
          <text x={width - padRight + 8} y={volTop + volHeight} fill="#62727d" fontSize="9" fontFamily="monospace">
            Vol
          </text>

          {/* Area gradient definition */}
          <defs>
            <linearGradient id="area-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#00f0ff" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        {/* Interactive Drawing Canvas Layer (Active in Maximized Mode) */}
        {isMaximized && (
          <StockChartDrawingCanvas
            width={width}
            height={height}
            drawings={drawings}
            onAddDrawing={(newDraw) => setDrawings((prev) => [...prev, newDraw])}
            onDeleteDrawing={(id) => setDrawings((prev) => prev.filter((d) => d.id !== id))}
            activeTool={activeTool}
            activeColor={activeColor}
            lineWidth={lineWidth}
            selectedIconType={selectedIconType}
            isLocked={isDrawingsLocked}
            isHidden={isDrawingsHidden}
          />
        )}

        {/* Engine branding watermark */}
        <div className="pointer-events-none absolute bottom-1.5 right-3 text-[9px] font-mono text-slate-500">
          TradingView Lightweight Visual Engine v2
        </div>
      </div>
    </div>
  )
}
