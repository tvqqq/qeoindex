"use client"

import type { ReactNode } from "react"
import { Activity, Award, CircleHelp, TrendingUp } from "lucide-react"

import type { BenchmarkComparison } from "@/modules/portfolio/performance/types"
import { BenchmarkReturnChart } from "./benchmark-return-chart"
import { performanceTermTitle } from "./terminology"

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

export function BenchmarkPanel({ benchmark }: { benchmark: BenchmarkComparison }) {
  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-amber-300">
            <TrendingUp className="h-4 w-4" /> Benchmark vs VN-Index
          </div>
          <h2 className="font-ticker text-lg font-black text-white">Danh mục so với VN-Index</h2>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600" title={performanceTermTitle("benchmark")}>
          <CircleHelp className="h-3.5 w-3.5" /> chung khoảng thời gian hợp lệ
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <BenchmarkMetric
          label="Danh mục"
          value={formatPercent(benchmark.portfolioReturnPercent)}
          icon={<Activity className="h-4 w-4 text-emerald-400" />}
          detail={benchmark.portfolioReturnPercent == null ? "Không đủ dữ liệu" : "Account Equity return"}
          title={performanceTermTitle("benchmark")}
        />
        <BenchmarkMetric
          label="VN-Index"
          value={formatPercent(benchmark.vnindexReturnPercent)}
          icon={<TrendingUp className="h-4 w-4 text-amber-300" />}
          detail={benchmark.vnindexReturnPercent == null ? "Không đủ dữ liệu" : "Benchmark return"}
          title={performanceTermTitle("benchmark")}
        />
        <BenchmarkMetric
          label="Alpha"
          value={formatPercent(benchmark.alphaPercent)}
          icon={<Award className="h-4 w-4 text-purple-400" />}
          detail={benchmark.alphaPercent == null ? "Không đủ dữ liệu" : "Chênh lệch danh mục - VN-Index"}
          title={performanceTermTitle("alpha")}
        />
      </div>

      {benchmark.completeness !== "complete" && (
        <div className="mb-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-100/70">
          {benchmark.reason ?? "Không đủ dữ liệu chung để so sánh danh mục với VN-Index."}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] font-bold text-slate-500">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm bg-[var(--color-up)]" /> Danh mục</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3.5 bg-[#e2b93b]" /> VN-Index</span>
        <span className="ml-auto font-normal text-slate-600">toàn danh mục · không đổi theo bộ lọc Trade</span>
      </div>
      <BenchmarkReturnChart dataPoints={benchmark.points} />
    </section>
  )
}

function BenchmarkMetric({
  label,
  value,
  icon,
  detail,
  title,
}: {
  label: string
  value: string
  icon: ReactNode
  detail: string
  title: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4" title={title}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className="font-ticker text-2xl font-black tabular-nums text-white">{value}</div>
      <div className="mt-1 text-[11px] text-slate-600">{detail}</div>
    </div>
  )
}
