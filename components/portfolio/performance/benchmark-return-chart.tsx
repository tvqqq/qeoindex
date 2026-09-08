"use client"

import { memo } from "react"
import { BarChart3 } from "lucide-react"

import type { BenchmarkPoint } from "@/modules/portfolio/performance/types"

export const BenchmarkReturnChart = memo(function BenchmarkReturnChart({
  dataPoints,
}: {
  dataPoints: readonly BenchmarkPoint[]
}) {
  if (dataPoints.length < 2) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.07] bg-[#090d13] px-6 text-center">
        <BarChart3 className="h-8 w-8 text-slate-700" />
        <div className="text-sm font-bold text-slate-300">Không đủ dữ liệu</div>
        <p className="max-w-md text-xs leading-relaxed text-slate-600">
          Biểu đồ cần ít nhất hai ngày có dữ liệu hoàn chỉnh chung giữa Account Equity và VN-Index.
        </p>
      </div>
    )
  }

  return (
    <div className="h-72 w-full rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
      <BenchmarkSvgChart data={dataPoints} />
    </div>
  )
})

const BenchmarkSvgChart = memo(function BenchmarkSvgChart({ data }: { data: readonly BenchmarkPoint[] }) {
  const width = 900
  const height = 270
  const padding = { top: 24, bottom: 34, left: 48, right: 24 }
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom
  const allReturns = data.flatMap((point) => [point.portfolioReturnPercent, point.vnindexReturnPercent])
  let minVal = Math.min(0, ...allReturns)
  let maxVal = Math.max(0, ...allReturns)
  const range = maxVal - minVal || 1
  minVal -= range * 0.1
  maxVal += range * 0.1

  const getX = (index: number) => padding.left + (index / (data.length - 1)) * chartW
  const getY = (value: number) => padding.top + chartH - ((value - minVal) / (maxVal - minVal)) * chartH
  const zeroY = getY(0)
  const portfolioPoints = data
    .map((point, index) => `${getX(index).toFixed(1)},${getY(point.portfolioReturnPercent).toFixed(1)}`)
    .join(" ")
  const indexPoints = data
    .map((point, index) => `${getX(index).toFixed(1)},${getY(point.vnindexReturnPercent).toFixed(1)}`)
    .join(" ")
  const areaPath = `M ${getX(0)},${zeroY} ${data
    .map((point, index) => `L ${getX(index).toFixed(1)},${getY(point.portfolioReturnPercent).toFixed(1)}`)
    .join(" ")} L ${getX(data.length - 1)},${zeroY} Z`

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full select-none overflow-visible" aria-label="Account Equity return versus VN-Index">
      <defs>
        <linearGradient id="qeoPerformanceGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-up)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-up)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[padding.top, padding.top + chartH / 2, padding.top + chartH].map((y) => (
        <line key={y} x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#ffffff" strokeOpacity={0.06} />
      ))}
      <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#ffffff" strokeOpacity={0.18} strokeDasharray="4 4" />
      <path d={areaPath} fill="url(#qeoPerformanceGradient)" />
      <polyline fill="none" stroke="#e2b93b" strokeWidth={2} strokeDasharray="5 3" points={indexPoints} />
      <polyline fill="none" stroke="var(--color-up)" strokeWidth={2.5} points={portfolioPoints} />
      <text x={padding.left - 8} y={padding.top + 4} fill="#718096" fontSize="9" textAnchor="end">{maxVal.toFixed(1)}%</text>
      <text x={padding.left - 8} y={zeroY + 3} fill="#718096" fontSize="9" textAnchor="end">0%</text>
      <text x={padding.left - 8} y={padding.top + chartH} fill="#718096" fontSize="9" textAnchor="end">{minVal.toFixed(1)}%</text>
      <text x={padding.left} y={height - 9} fill="#718096" fontSize="9">{data[0]!.date}</text>
      <text x={width - padding.right - 62} y={height - 9} fill="#718096" fontSize="9">{data.at(-1)!.date}</text>
    </svg>
  )
})
