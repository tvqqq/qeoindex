"use client"

import React, { useState, useEffect, memo } from "react"
import { TrendingUp, Award, Activity, BarChart3, Loader2 } from "lucide-react"

import { cn } from "@/modules/shared/ui/cn"

interface BenchmarkDataPoint {
  date: string
  portfolioReturnPct: number
  vnindexReturnPct: number
}

interface PortfolioBenchmarkChartProps {
  portfolioId: string
}

export const PortfolioBenchmarkChart = memo(function PortfolioBenchmarkChart({
  portfolioId,
}: PortfolioBenchmarkChartProps) {
  const [dataPoints, setDataPoints] = useState<BenchmarkDataPoint[]>([])
  const [portfolioReturnPct, setPortfolioReturnPct] = useState(0)
  const [vnindexReturnPct, setVnindexReturnPct] = useState(0)
  const [alphaPct, setAlphaPct] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!portfolioId) return
    setLoading(true)
    fetch(`/api/portfolio/${portfolioId}/benchmark`, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ok) {
          setDataPoints(data.dataPoints || [])
          setPortfolioReturnPct(data.portfolioReturnPct || 0)
          setVnindexReturnPct(data.vnindexReturnPct || 0)
          setAlphaPct(data.alphaPct || 0)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portfolioId])

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-3xl border border-[var(--color-border)] bg-[#0b0f13]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-2)]" />
      </div>
    )
  }

  if (dataPoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-[#2a2e40] bg-[#0b0f13] p-12 text-center">
        <BarChart3 className="h-10 w-10 text-[var(--color-muted)]" />
        <h3 className="font-ticker text-base font-bold text-white">Chưa đủ dữ liệu so sánh hiệu suất</h3>
        <p className="max-w-md font-ticker text-xs sm:text-sm text-[var(--color-muted-2)] font-medium">
          Hãy nhập các giao dịch mua/bán trong danh mục để hệ thống bắt đầu đo lường <span className="text-purple-300 italic font-semibold">tỷ suất sinh lời tích lũy</span> và so sánh với chỉ số VN-Index.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 font-ticker">
      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Portfolio Return */}
        <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)] mb-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--color-up)]" /> Tỉ suất Danh mục
            </span>
            <Activity className="h-4 w-4 text-[var(--color-up)]" />
          </div>
          <div
            className={cn(
              "font-ticker text-2xl sm:text-3xl font-black tracking-tight tabular-nums",
              portfolioReturnPct >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]",
            )}
          >
            {portfolioReturnPct >= 0 ? "+" : ""}
            {portfolioReturnPct.toFixed(2)}%
          </div>
          <p className="font-ticker text-xs text-[var(--color-muted-2)] mt-1 italic">Từ ngày giải ngân đầu tiên</p>
        </div>

        {/* VNINDEX Return */}
        <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)] mb-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#e2b93b]" /> VN-Index (Benchmark)
            </span>
            <TrendingUp className="h-4 w-4 text-[#e2b93b]" />
          </div>
          <div
            className={cn(
              "font-ticker text-2xl sm:text-3xl font-black tracking-tight tabular-nums",
              vnindexReturnPct >= 0 ? "text-[#e2b93b]" : "text-[var(--color-down)]",
            )}
          >
            {vnindexReturnPct >= 0 ? "+" : ""}
            {vnindexReturnPct.toFixed(2)}%
          </div>
          <p className="font-ticker text-xs text-[var(--color-muted-2)] mt-1 italic">Biến động thị trường chung</p>
        </div>

        {/* Alpha */}
        <div className="rounded-3xl border border-purple-500/40 bg-gradient-to-br from-purple-900/20 to-indigo-900/20 p-5 shadow-sm">
          <div className="flex items-center justify-between text-xs text-purple-300 mb-1">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
              <Award className="h-4 w-4 text-purple-400" /> Chỉ số Alpha
            </span>
            <span className="font-ticker text-[10px] uppercase font-bold text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full">
              Outperformance
            </span>
          </div>
          <div
            className={cn(
              "font-ticker text-2xl sm:text-3xl font-black tracking-tight tabular-nums",
              alphaPct >= 0 ? "text-purple-300" : "text-[var(--color-down)]",
            )}
          >
            {alphaPct >= 0 ? "+" : ""}
            {alphaPct.toFixed(2)}%
          </div>
          <p className="font-ticker text-xs text-purple-300/80 mt-1 italic">
            {alphaPct >= 0 ? "Hiệu suất vượt trội so với VN-Index" : "Hiệu suất thấp hơn VN-Index"}
          </p>
        </div>
      </div>

      {/* Chart Canvas Card */}
      <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--color-border)] pb-3">
          <h3 className="font-ticker text-sm sm:text-base font-extrabold text-white uppercase tracking-wide">
            Biểu đồ Tăng trưởng Lũy kế (% Cumulative Return)
          </h3>
          <div className="flex items-center gap-4 text-xs font-ticker">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-3.5 rounded-sm bg-[var(--color-up)]" />
              <span className="text-white font-bold">Danh mục</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1 w-3.5 bg-[#e2b93b]" />
              <span className="text-[#e2b93b] font-bold">VN-Index</span>
            </div>
          </div>
        </div>

        <div className="h-72 w-full">
          <BenchmarkSvgChart data={dataPoints} />
        </div>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// Benchmark Comparison SVG Line Chart
// ─────────────────────────────────────────────────────────────

interface BenchmarkSvgChartProps {
  data: BenchmarkDataPoint[]
}

const BenchmarkSvgChart = memo(function BenchmarkSvgChart({ data }: BenchmarkSvgChartProps) {
  if (data.length < 2) return null

  const width = 800
  const height = 260
  const padding = { top: 25, bottom: 35, left: 45, right: 25 }

  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  // Domain computation
  const allReturns = data.flatMap((d) => [d.portfolioReturnPct, d.vnindexReturnPct])
  let minVal = Math.min(0, ...allReturns)
  let maxVal = Math.max(0, ...allReturns)

  const range = maxVal - minVal || 1
  minVal = minVal - range * 0.1
  maxVal = maxVal + range * 0.1

  const getX = (idx: number) => padding.left + (idx / (data.length - 1)) * chartW
  const getY = (val: number) => padding.top + chartH - ((val - minVal) / (maxVal - minVal)) * chartH

  const zeroY = getY(0)

  // Portfolio Points
  const portPoints = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.portfolioReturnPct).toFixed(1)}`).join(" ")

  // VNINDEX Points
  const indexPoints = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.vnindexReturnPct).toFixed(1)}`).join(" ")

  // Area under portfolio curve
  const areaPath = `M ${getX(0)},${zeroY} ${data.map((d, i) => `L ${getX(i).toFixed(1)},${getY(d.portfolioReturnPct).toFixed(1)}`).join(" ")} L ${getX(data.length - 1)},${zeroY} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full select-none overflow-visible">
      <defs>
        <linearGradient id="portGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-up)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--color-up)" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {/* Grid Lines */}
      <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#ffffff" strokeOpacity={0.06} />
      <line x1={padding.left} y1={padding.top + chartH / 2} x2={width - padding.right} y2={padding.top + chartH / 2} stroke="#ffffff" strokeOpacity={0.06} />
      <line x1={padding.left} y1={padding.top + chartH} x2={width - padding.right} y2={padding.top + chartH} stroke="#ffffff" strokeOpacity={0.06} />

      {/* Zero baseline */}
      <line
        x1={padding.left}
        y1={zeroY}
        x2={width - padding.right}
        y2={zeroY}
        stroke="#ffffff"
        strokeOpacity={0.2}
        strokeDasharray="4 4"
      />
      <text x={padding.left - 8} y={zeroY + 3} fill="#8a9ba7" fontSize="10" fontFamily="sans-serif" textAnchor="end" fontWeight="bold">
        0%
      </text>

      {/* Top and bottom labels */}
      <text x={padding.left - 8} y={padding.top + 4} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif" textAnchor="end">
        +{maxVal.toFixed(1)}%
      </text>
      <text x={padding.left - 8} y={padding.top + chartH} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif" textAnchor="end">
        {minVal.toFixed(1)}%
      </text>

      {/* Portfolio Area */}
      <path d={areaPath} fill="url(#portGradient)" />

      {/* VN-Index Line (Dashed Amber) */}
      <polyline
        fill="none"
        stroke="#e2b93b"
        strokeWidth={2}
        strokeDasharray="5 3"
        points={indexPoints}
      />

      {/* Portfolio Line (Solid Emerald) */}
      <polyline
        fill="none"
        stroke="var(--color-up)"
        strokeWidth={2.5}
        points={portPoints}
      />

      {/* X Axis Dates */}
      <text x={padding.left} y={height - 10} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif">
        {data[0].date}
      </text>
      <text x={width - padding.right - 50} y={height - 10} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif">
        {data[data.length - 1].date}
      </text>
    </svg>
  )
})
