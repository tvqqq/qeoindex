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

  const displayBars = useMemo(() => {
    if (!bars || bars.length === 0) return []
    if (timeframe === "1D") return bars.slice(-60)
    if (timeframe === "1W") return bars.slice(-90)
    if (timeframe === "1M") return bars.slice(-120)
    return bars.slice(-200)
  }, [bars, timeframe])

  const ma20 = useMemo(() => calculateSma(bars, 20).slice(-displayBars.length), [bars, displayBars.length])
  const ma50 = useMemo(() => calculateSma(bars, 50).slice(-displayBars.length), [bars, displayBars.length])

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

  // Chart dimensions
  const width = 860
  const height = 290
  const padLeft = 14
  const padRight = 56
  const padTop = 16
  const priceHeight = 185
  const volTop = 220
  const volHeight = 45
  const plotWidth = width - padLeft - padRight

  const getX = (idx: number) => padLeft + (idx / Math.max(1, displayBars.length - 1)) * plotWidth
  const getY = (price: number) => {
    if (!chartMetrics) return 0
    return padTop + ((chartMetrics.max - price) / chartMetrics.range) * priceHeight
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

  if (!displayBars.length || !chartMetrics) {
    return (
      <div className="flex h-[290px] items-center justify-center rounded-2xl border border-white/[0.08] bg-[#080d13] p-6 text-sm text-slate-500">
        Đang nạp dữ liệu nến TradingView {ticker}...
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
      {/* Top Header Controls & Live Crosshair Info */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] bg-[#0a0f16] px-4 py-2.5 text-xs">
        {/* Timeframe Buttons */}
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-bold text-slate-500 font-mono">Khung:</span>
          {(["1D", "1W", "1M", "1Y"] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={cn(
                "rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold transition-all",
                timeframe === tf
                  ? "border border-cyan-400/30 bg-cyan-400/15 text-cyan-200 shadow-[0_0_10px_rgba(0,240,255,0.2)]"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
              )}
            >
              {tf}
            </button>
          ))}
          <div className="mx-2 h-3.5 w-px bg-white/[0.1]" />
          <span className="flex items-center gap-1 font-mono text-[11px] text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            MA20: {ma20.at(-1)?.toFixed(1) || "—"}
          </span>
          <span className="ml-2 flex items-center gap-1 font-mono text-[11px] text-amber-300">
            <span className="size-1.5 rounded-full bg-amber-400" />
            MA50: {ma50.at(-1)?.toFixed(1) || "—"}
          </span>
        </div>

        {/* OHLCV readout */}
        {activeBar && (
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-slate-400">
            <span>
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
      </div>

      {/* SVG Canvas Rendering */}
      <div
        className="relative w-full cursor-crosshair"
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
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[270px] w-full" preserveAspectRatio="none">
          {/* Horizontal Grid lines */}
          <line x1={padLeft} y1={padTop} x2={width - padRight} y2={padTop} stroke="#182330" strokeDasharray="3 3" opacity="0.6" />
          <line x1={padLeft} y1={padTop + priceHeight * 0.33} x2={width - padRight} y2={padTop + priceHeight * 0.33} stroke="#182330" strokeDasharray="3 3" opacity="0.6" />
          <line x1={padLeft} y1={padTop + priceHeight * 0.66} x2={width - padRight} y2={padTop + priceHeight * 0.66} stroke="#182330" strokeDasharray="3 3" opacity="0.6" />
          <line x1={padLeft} y1={padTop + priceHeight} x2={width - padRight} y2={padTop + priceHeight} stroke="#182330" opacity="0.8" />

          {/* Volume Baseline */}
          <line x1={padLeft} y1={volTop + volHeight} x2={width - padRight} y2={volTop + volHeight} stroke="#182330" opacity="0.8" />

          {/* Volume Bars */}
          {displayBars.map((bar, i) => {
            const x = getX(i)
            const vH = (bar.volume / chartMetrics.maxVol) * volHeight
            const isBull = bar.close >= bar.open
            const barW = Math.max(2, plotWidth / displayBars.length - 1.5)
            return (
              <rect
                key={`v-${bar.time}`}
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

          {/* Candlestick Bars */}
          {displayBars.map((bar, i) => {
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
              <g key={`c-${bar.time}`}>
                <line x1={x} y1={highY} x2={x} y2={lowY} stroke={color} strokeWidth="1.2" />
                <rect
                  x={x - candleW / 2}
                  y={bodyTop}
                  width={candleW}
                  height={bodyHeight}
                  fill={color}
                  rx="1"
                />
              </g>
            )
          })}

          {/* Moving Averages */}
          <path d={ma20Path} fill="none" stroke="#10b981" strokeWidth="1.6" opacity="0.85" />
          <path d={ma50Path} fill="none" stroke="#f59e0b" strokeWidth="1.6" opacity="0.75" />

          {/* Crosshair indicator */}
          {hoverIndex !== null && (
            <g>
              <line
                x1={getX(hoverIndex)}
                y1={padTop}
                x2={getX(hoverIndex)}
                y2={volTop + volHeight}
                stroke="#00f0ff"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.7"
              />
            </g>
          )}

          {/* Price Axis Labels on the right */}
          <text x={width - padRight + 8} y={padTop + 4} fill="#8a9ba7" fontSize="10" fontFamily="monospace">
            {chartMetrics.max.toFixed(1)}
          </text>
          <text x={width - padRight + 8} y={padTop + priceHeight * 0.5 + 4} fill="#8a9ba7" fontSize="10" fontFamily="monospace">
            {(chartMetrics.min + chartMetrics.range * 0.5).toFixed(1)}
          </text>
          <text x={width - padRight + 8} y={padTop + priceHeight + 4} fill="#8a9ba7" fontSize="10" fontFamily="monospace">
            {chartMetrics.min.toFixed(1)}
          </text>
          <text x={width - padRight + 8} y={volTop + volHeight} fill="#62727d" fontSize="9" fontFamily="monospace">
            Vol
          </text>
        </svg>

        <div className="pointer-events-none absolute bottom-1.5 right-3 text-[9px] font-mono text-slate-500">
          TradingView Lightweight Visual Engine
        </div>
      </div>
    </div>
  )
}
