"use client"

import { Layers3, TriangleAlert } from "lucide-react"

import type { PerformanceSegment } from "@/modules/portfolio/performance/types"

const DIMENSION_LABELS: Record<PerformanceSegment["dimension"], string> = {
  system: "Hệ thống",
  setup: "Setup",
  timeframe: "Khung thời gian",
  mode: "Chế độ",
  behavior: "Hành vi",
  mistake: "Sai lầm",
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${value.toFixed(1)}%`
}

function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return value.toFixed(2)
}

function formatVnd(value: number): string {
  return `${Math.round(value).toLocaleString("vi-VN")} ₫`
}

export function SegmentsPanel({ segments }: { segments: readonly PerformanceSegment[] }) {
  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-fuchsia-400">
            <Layers3 className="h-4 w-4" /> Segmentation
          </div>
          <h2 className="font-ticker text-lg font-black text-white">Chẩn đoán theo phân nhóm</h2>
          <p className="mt-1 text-xs text-slate-500">Các nhóm tag có thể chồng lặp; không cộng ngang các hàng để suy ra tổng danh mục.</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-[#090d13]">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wider text-slate-600">
            <tr>
              <th className="px-4 py-3">Phân nhóm</th>
              <th className="px-4 py-3">Giá trị</th>
              <th className="px-4 py-3 text-right">Mẫu</th>
              <th className="px-4 py-3 text-right">Tỷ lệ thắng</th>
              <th className="px-4 py-3 text-right">Payoff</th>
              <th className="px-4 py-3 text-right">P/L ròng</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {segments.map((segment) => (
              <tr key={`${segment.dimension}:${segment.key}`} className="hover:bg-white/[0.015]">
                <td className="px-4 py-3 text-slate-500">{DIMENSION_LABELS[segment.dimension]}</td>
                <td className="px-4 py-3 font-bold text-slate-200">
                  <span className="inline-flex items-center gap-1.5">
                    {segment.key}
                    {segment.smallSample && (
                      <span title="Mẫu nhỏ — cần thận trọng khi diễn giải.">
                        <TriangleAlert className="h-3.5 w-3.5 text-amber-300" />
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-400">{segment.sampleSize}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">{formatPercent(segment.winRatioPercent)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-300">{formatRatio(segment.payoffRatio)}</td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-200">{formatVnd(segment.netPnlVnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {segments.length === 0 && (
        <div className="py-8 text-center text-xs text-slate-500">Không đủ dữ liệu phân nhóm.</div>
      )}
    </section>
  )
}
