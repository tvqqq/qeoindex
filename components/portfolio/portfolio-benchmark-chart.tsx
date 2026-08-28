"use client"

import React, { useState, useEffect, useMemo, memo } from "react"
import { TrendingUp, Award, Activity, BarChart3, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

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
      <div className="flex h-64 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[#0b0f13]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-2)]" />
      </div>
    )
  }

  if (dataPoints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-12 text-center">
        <BarChart3 className="h-10 w-10 text-[var(--color-muted)]" />
        <h3 className="text-sm font-semibold text-white">Chưa đủ dữ liệu so sánh hiệu suất</h3>
        <p className="max-w-md text-xs text-[var(--color-muted-2)]">
          Hãy nhập các giao dịch mua/bán trong danh mục để hệ thống bắt đầu đo lường tỷ suất sinh lời tích lũy và so sánh với chỉ số VN-Index.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Portfolio Return */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted-2)] mb-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--color-up)]" /> Tỉ suất Danh mục
            </span>
            <Activity className="h-3.5 w-3.5" />
          </div>
          <div
            className={cn(
              "font-ticker text-2xl font-black",
              portfolioReturnPct >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]",
            )}
          >
            {portfolioReturnPct >= 0 ? "+" : ""}
            {portfolioReturnPct.toFixed(2)}%
          </div>
          <p className="text-[10px] text-[var(--color-muted-2)] mt-1">Từ ngày giải ngân đầu tiên</p>
        </div>

        {/* VNINDEX Return */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-4">
          <div className="flex items-center justify-between text-xs text-[var(--color-muted-2)] mb-1">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#e2b93b]" /> VN-Index (Benchmark)
            </span>
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <div
            className={cn(
              "font-ticker text-2xl font-black",
              vnindexReturnPct >= 0 ? "text-[#e2b93b]" : "text-[var(--color-down)]",
            )}
          >
            {vnindexReturnPct >= 0 ? "+" : ""}
            {vnindexReturnPct.toFixed(2)}%
          </div>
          <p className="text-[10px] text-[var(--color-muted-2)] mt-1">Biến động thị trường chung</p>
        </div>

        {/* Alpha */}
        <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4">
          <div className="flex items-center justify-between text-xs text-purple-300 mb-1">
            <span className="flex items-center gap-1.5 font-bold">
              <Award className="h-3.5 w-3.5 text-purple-400" /> Chỉ số Alpha
            </span>
            <span className="text-[10px] uppercase font-bold text-purple-400">Outperformance</span>
          </div>
          <div
            className={cn(
              "font-ticker text-2xl font-black",
              alphaPct >= 0 ? "text-purple-300" : "text-[var(--color-down)]",
            )}
          >
            {alphaPct >= 0 ? "+" : ""}
            {alphaPct.toFixed(2)}%
          </div>
          <p className="text-[10px] text-purple-300/80 mt-1">
            {alphaPct >= 0 ? "Hiệu suất vượt trội so với VN-Index" : "Hiệu suất thấp hơn VN-Index"}
          </p>
        </div>
      </div>

      {/* Chart Canvas Card */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[#0b0f13] p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-white uppercase tracking-wider">
            Biểu đồ Tăng trưởng Lũy kế (% Cumulative Return)
          </h3>
          <div className="flex items-center gap-4 text-xs font-ticker">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm bg-[var(--color-up)]" />
              <span className="text-white font-medium">Danh mục</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 bg-[#e2b93b]" />
              <span className="text-[#e2b93b] font-medium">VN-Index</span>
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          <BenchmarkSvgChart data={dataPoints} />
        </div>
      </div>
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// Benchmark SVG Line Chart
// ─────────────────────────────────────────────────────────────

interface BenchmarkSvgChartProps {
  data: BenchmarkDataPoint[]
}

const BenchmarkSvgChart = memo(function BenchmarkSvgChart({ data }: BenchmarkSvgChartProps) {
  if (data.length < 2) return null

  const width = 800
  const height = 240
  const padding = { top: 20, bottom: 30, left: 45, right: 30 }

  const allVals = data.flatMap((d) => [d.portfolioReturnPct, d.vnindexReturnPct, 0])
  let minV = Math.min(...allVals)
  let maxV = Math.max(...allVals)

  const range = maxV - minV || 1
  minV = minV - range * 0.1
  maxV = maxV + range * 0.1

  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const getX = (idx: number) => padding.left + (idx / (data.length - 1)) * chartW
  const getY = (val: number) => padding.top + chartH - ((val - minV) / (maxV - minV)) * chartH

  const zeroY = getY(0)

  // Portfolio Points
  const portPoints = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.portfolioReturnPct).toFixed(1)}`).join(" ")
  // VNINDEX Points
  const vnindexPoints = data.map((d, i) => `${getX(i).toFixed(1)},${getY(d.vnindexReturnPct).toFixed(1)}`).join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full select-none overflow-visible">
      {/* Zero baseline */}
      <line
        x1={padding.left}
        y1={zeroY}
        x2={width - padding.right}
        y2={zeroY}
        stroke="#ffffff"
        strokeOpacity={0.15}
        strokeDasharray="4 4"
      />
      <text x={padding.left - 30} y={zeroY + 3} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif">
        0.0%
      </text>

      {/* VN-Index Line (Amber Dashed) */}
      <polyline fill="none" stroke="#e2b93b" strokeWidth={1.8} strokeDasharray="5 3" points={vnindexPoints} />

      {/* Portfolio Line (Emerald Solid) */}
      <polyline fill="none" stroke="var(--color-up)" strokeWidth={2.5} points={portPoints} />

      {/* Ticks on X Axis */}
      <text x={padding.left} y={height - 8} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif">
        {data[0].date}
      </text>
      <text x={width - padding.right - 55} y={height - 8} fill="#8a9ba7" fontSize="9" fontFamily="sans-serif">
        {data[data.length - 1].date}
      </text>
    </svg>
  )
})
