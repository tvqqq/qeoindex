"use client"

import React, { useMemo, useState } from "react"
import type { OhlcvBar } from "@/modules/shared/technical/indicators"
import { cn } from "@/modules/shared/ui/cn"

interface StockTradingViewChartProps {
  ticker: string
  bars: OhlcvBar[]
}

type Timeframe = "1D" | "1W" | "1M" | "1Y"

function calculateSma(bars: OhlcvBar[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(bars.length).fill(null)
  let sum = 0
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close
    if (i >= period) sum -= bars[i - period].close
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

export function StockTradingViewChart({ ticker, bars }: StockTradingViewChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>("1D")
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  // Filter bars according to timeframe
  const displayBars = useMemo(() => {
    if (!bars || bars.length === 0) return []
    if (timeframe === "1D") return bars.slice(-60)
    if (timeframe === "1W") return bars.slice(-90)
    if (timeframe === "1M") return bars.slice(-120)
    return bars.slice(-200)
  }, [bars, timeframe])

  // Moving averages
  const ma20 = useMemo(() => calculateSma(bars, 20).slice(-displayBars.length), [bars, displayBars.length])
  const ma50 = useMemo(() => calculateSma(bars, 50).slice(-displayBars.length), [bars, displayBars.length])

  // Coordinate scales
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

    const padding = (maxPrice - minPrice) * 0.08 || 1
    const priceRange = maxPrice - minPrice + padding * 2

    return {
      min: minPrice - padding,
      max: maxPrice + padding,
      range: priceRange,
      maxVol: Math.max(maxVol, 1),
    }
  }, [displayBars])

  const activeBar = hoverIndex !== null && displayBars[hoverIndex] ? displayBars[hoverIndex] : displayBars.at(-1)

  // SVG Chart Dimensions
  const width = 800
  const height = 230
  const padLeft = 10
  const padRight = 50
  const padTop = 15
  const padBottom = 35
  const plotWidth = width - padLeft - padRight
  const pricePlotHeight = height - padTop - padBottom - 35
  const volTop = height - padBottom - 30
  const volHeight = 28

  const getX = (idx: number) => padLeft + (idx / Math.max(1, displayBars.length - 1)) * plotWidth
  const getY = (price: number) => {
    if (!chartMetrics) return 0
    return padTop + ((chartMetrics.max - price) / chartMetrics.range) * pricePlotHeight
  }

  // Generate SVG path for MA
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

  if (!displayBars.length || !chartMetrics) {
    return (
      <div className="flex h-[230px] items-center justify-center border-b border-[#141d27] bg-[#070b10] text-xs text-slate-500">
        Đang nạp dữ liệu nến TradingView {ticker}...
      </div>
    )
  }

  return (
    <div className="relative flex h-[235px] flex-col border-b border-[#141d27] bg-[#070b10]">
      {/* Top Controls & OHLCV Crosshair Display */}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#141d27] bg-[#090d13] px-3 text-[11px]">
        {/* Timeframe Buttons */}
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-slate-500">Khung:</span>
          {(["1D", "1W", "1M", "1Y"] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={cn(
                "rounded px-2 py-0.5 font-mono text-[10px] font-bold transition-colors",
                timeframe === tf
                  ? "border border-cyan-700/50 bg-cyan-950/80 text-cyan-300"
                  : "text-slate-400 hover:text-white"
              )}
            >
              {tf}
            </button>
          ))}
          <div className="mx-2 h-3 w-px bg-[#1e2a38]" />
          <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            MA20: {ma20.at(-1)?.toFixed(1) || "—"}
          </span>
          <span className="ml-2 flex items-center gap-1 font-mono text-[10px] text-amber-400">
            <span className="size-1.5 rounded-full bg-amber-400" />
            MA50: {ma50.at(-1)?.toFixed(1) || "—"}
          </span>
        </div>

        {/* Dynamic O-H-L-C-V Readout */}
        {activeBar && (
          <div className="flex items-center gap-2.5 font-mono text-[10px] text-slate-400">
            <span>
              {new Date(activeBar.time * 1000).toLocaleDateString("vi-VN", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
            <span>
              O: <b className="text-slate-200">{activeBar.open.toLocaleString()}</b>
            </span>
            <span>
              H: <b className="text-emerald-400">{activeBar.high.toLocaleString()}</b>
            </span>
            <span>
              L: <b className="text-rose-400">{activeBar.low.toLocaleString()}</b>
            </span>
            <span>
              C:{" "}
              <b className={activeBar.close >= activeBar.open ? "text-emerald-400" : "text-rose-400"}>
                {activeBar.close.toLocaleString()}
              </b>
            </span>
            <span>
              V: <b className="text-slate-200">{(activeBar.volume / 1_000_000).toFixed(2)}M</b>
            </span>
          </div>
        )}
      </div>

      {/* SVG Canvas Chart */}
      <div
        className="relative flex-1 w-full cursor-crosshair"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const relX = e.clientX - rect.left - (padLeft * rect.width) / width
          const effectiveWidth = (plotWidth * rect.width) / width
          const ratio = Math.max(0, Math.min(1, relX / effectiveWidth))
          const idx = Math.round(ratio * (displayBars.length - 1))
          setHoverIndex(idx)
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none">
          {/* Background Grid Lines */}
          <line x1={padLeft} y1={padTop + pricePlotHeight * 0.25} x2={width - padRight} y2={padTop + pricePlotHeight * 0.25} stroke="#141c26" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + pricePlotHeight * 0.5} x2={width - padRight} y2={padTop + pricePlotHeight * 0.5} stroke="#141c26" strokeDasharray="3 3" />
          <line x1={padLeft} y1={padTop + pricePlotHeight * 0.75} x2={width - padRight} y2={padTop + pricePlotHeight * 0.75} stroke="#141c26" strokeDasharray="3 3" />

          {/* Volume Histogram Bars */}
          {displayBars.map((bar, i) => {
            const x = getX(i)
            const vHeight = (bar.volume / chartMetrics.maxVol) * volHeight
            const isBull = bar.close >= bar.open
            const barW = Math.max(2, plotWidth / displayBars.length - 2)
            return (
              <rect
                key={bar.time}
                x={x - barW / 2}
                y={volTop + volHeight - vHeight}
                width={barW}
                height={vHeight}
                fill={isBull ? "#10b981" : "#ef4444"}
                opacity="0.35"
              />
            )
          })}

          {/* Candlestick Bars */}
          {displayBars.map((bar, i) => {
            const x = getX(i)
            const isBull = bar.close >= bar.open
            const color = isBull ? "#10b981" : "#ef4444"
            const highY = getY(bar.high)
            const lowY = getY(bar.low)
            const openY = getY(bar.open)
            const closeY = getY(bar.close)
            const bodyTop = Math.min(openY, closeY)
            const bodyHeight = Math.max(1.5, Math.abs(closeY - openY))
            const candleWidth = Math.max(2.5, plotWidth / displayBars.length - 2.5)

            return (
              <g key={`c-${bar.time}`}>
                {/* Wick */}
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1" />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={color}
                  rx="0.5"
                />
              </g>
            )
          })}

          {/* Moving Average Overlays */}
          <path d={ma20Path} fill="none" stroke="#10b981" strokeWidth="1.5" opacity="0.85" />
          <path d={ma50Path} fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.75" />

          {/* Hover Crosshair Guide */}
          {hoverIndex !== null && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={padTop}
                x2={getX(hoverIndex)}
                y2={height - padBottom}
                stroke="#00f0ff"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.7"
              />
            </g>
          )}

          {/* Price Axis Labels on the right */}
          <text x={width - padRight + 6} y={padTop + 6} fill="#62727d" fontSize="9" fontFamily="monospace">
            {chartMetrics.max.toFixed(1)}
          </text>
          <text x={width - padRight + 6} y={padTop + pricePlotHeight * 0.5 + 3} fill="#62727d" fontSize="9" fontFamily="monospace">
            {(chartMetrics.min + chartMetrics.range * 0.5).toFixed(1)}
          </text>
          <text x={width - padRight + 6} y={padTop + pricePlotHeight} fill="#62727d" fontSize="9" fontFamily="monospace">
            {chartMetrics.min.toFixed(1)}
          </text>
        </svg>

        <div className="pointer-events-none absolute bottom-1 right-2 text-[8px] font-mono text-slate-600">
          Lightweight Canvas Engine
        </div>
      </div>
    </div>
  )
}
