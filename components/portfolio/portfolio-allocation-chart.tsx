"use client"

import React, { useMemo, memo } from "react"

import { PortfolioPosition } from "@/modules/portfolio/pnl"

// Vibrant, distinct palette for dark financial UI
const SLICE_COLORS = [
  "#7c5cff", // violet
  "#36c5f0", // cyan
  "#b084ff", // purple
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#10b981", // green
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#f97316", // orange
]

interface PortfolioAllocationChartProps {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
}

interface SliceData {
  ticker: string
  marketValue: number
  pct: number
  color: string
  startAngle: number
  endAngle: number
}

function formatVND(kVND: number): string {
  const abs = Math.abs(kVND)
  if (abs >= 1_000_000) return `${(kVND / 1_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000) return `${(kVND / 1_000).toFixed(1)} tr`
  return `${kVND.toFixed(0)} k₫`
}

export const PortfolioAllocationChart = memo(function PortfolioAllocationChart({
  positions,
  currentPrices,
}: PortfolioAllocationChartProps) {
  const { slices, totalMarketValue } = useMemo(() => {
    let totalMkt = 0
    const raw = positions.map((p) => {
      const price = currentPrices[p.ticker] ?? p.avgCost
      const mkt = price * p.openQty
      totalMkt += mkt
      return { ticker: p.ticker, marketValue: mkt }
    })

    // Sort by marketValue descending
    raw.sort((a, b) => b.marketValue - a.marketValue)

    let currentAngle = 0
    const sliceList: SliceData[] = raw.map((item, idx) => {
      const pct = totalMkt > 0 ? (item.marketValue / totalMkt) * 100 : 0
      const angleSpan = totalMkt > 0 ? (item.marketValue / totalMkt) * 360 : 0
      const startAngle = currentAngle
      const endAngle = currentAngle + angleSpan
      currentAngle = endAngle

      return {
        ticker: item.ticker,
        marketValue: item.marketValue,
        pct,
        color: SLICE_COLORS[idx % SLICE_COLORS.length],
        startAngle,
        endAngle,
      }
    })

    return { slices: sliceList, totalMarketValue: totalMkt }
  }, [positions, currentPrices])

  if (positions.length === 0 || totalMarketValue === 0) {
    return null
  }

  // SVG Donut dimensions
  const size = 160
  const radius = 65
  const innerRadius = 45
  const center = size / 2

  function polarToCartesian(cx: number, cy: number, r: number, angleInDegrees: number) {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0
    return {
      x: cx + r * Math.cos(angleInRadians),
      y: cy + r * Math.sin(angleInRadians),
    }
  }

  function describeArc(
    cx: number,
    cy: number,
    outerR: number,
    innerR: number,
    startAngle: number,
    endAngle: number,
  ) {
    // If arc is virtually 360 degrees
    const delta = endAngle - startAngle
    const safeEndAngle = delta >= 359.99 ? startAngle + 359.99 : endAngle

    const outerStart = polarToCartesian(cx, cy, outerR, startAngle)
    const outerEnd = polarToCartesian(cx, cy, outerR, safeEndAngle)
    const innerStart = polarToCartesian(cx, cy, innerR, safeEndAngle)
    const innerEnd = polarToCartesian(cx, cy, innerR, startAngle)

    const largeArcFlag = delta <= 180 ? "0" : "1"

    return [
      `M ${outerStart.x} ${outerStart.y}`,
      `A ${outerR} ${outerR} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerR} ${innerR} 0 ${largeArcFlag} 0 ${innerEnd.x} ${innerEnd.y}`,
      "Z",
    ].join(" ")
  }

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-[#252837] bg-[#11131c] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
      <div className="flex items-center justify-between">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f8292]">Allocation</p><h3 className="mt-1 text-sm font-semibold text-white">Phân bổ tỷ trọng</h3></div>
        <span className="font-ticker text-xs text-[var(--color-muted-2)]">
          {positions.length} mã ({formatVND(totalMarketValue)})
        </span>
      </div>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-around">
        {/* SVG Donut */}
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
            {slices.map((s) => {
              if (s.endAngle - s.startAngle <= 0.1) return null
              const pathD = describeArc(center, center, radius, innerRadius, s.startAngle, s.endAngle)
              return (
                <path
                  key={s.ticker}
                  d={pathD}
                  fill={s.color}
                  className="transition-opacity duration-150 hover:opacity-80"
                />
              )
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <span className="font-ticker text-xs font-bold text-white">100%</span>
            <span className="text-[10px] text-[var(--color-muted-2)]">Phân bổ</span>
          </div>
        </div>

        {/* Legend pills */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-1">
          {slices.slice(0, 8).map((s) => (
            <div key={s.ticker} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-ticker font-semibold uppercase text-white truncate">
                  {s.ticker}
                </span>
              </div>
              <div className="flex items-center gap-1 text-right">
                <span className="font-ticker font-medium text-[var(--color-muted-2)]">
                  {s.pct.toFixed(1)}%
                </span>
                <span className="font-ticker text-[11px] text-[var(--color-muted-2)] opacity-70">
                  ({formatVND(s.marketValue)})
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
