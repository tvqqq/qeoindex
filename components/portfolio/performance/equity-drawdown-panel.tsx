"use client"

import { Activity, CircleHelp, ShieldAlert, Waves } from "lucide-react"

import type { PerformanceReadModel } from "@/modules/portfolio/performance/types"
import { PERFORMANCE_TERMINOLOGY, performanceTermTitle } from "./terminology"

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${Math.round(value).toLocaleString("vi-VN")} ₫`
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function metricReason(value: number | null, completeness: "complete" | "insufficient"): string | null {
  if (value != null && completeness === "complete") return null
  return "Không đủ dữ liệu"
}

export function EquityDrawdownPanel({ equity }: { equity: PerformanceReadModel["equity"] }) {
  const latest = equity.points.at(-1) ?? null
  const recentEpisodes = equity.episodes.slice(-4).reverse()

  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-cyan-400">
            <Waves className="h-4 w-4" /> Account Equity & Drawdown
          </div>
          <h2 className="font-ticker text-lg font-black text-white">Giá trị tài khoản & sụt giảm</h2>
        </div>
        <div
          className="flex items-center gap-1.5 text-xs text-slate-500"
          title={performanceTermTitle("accountEquity")}
        >
          <CircleHelp className="h-3.5 w-3.5" />
          {PERFORMANCE_TERMINOLOGY.accountEquity.labelEn}
        </div>
      </div>

      {equity.completeness !== "complete" && (
        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-xs text-amber-200/80">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Không đủ dữ liệu giá RAW liên tục để kết luận đầy đủ về Account Equity/Drawdown. Các metric thiếu được giữ ở trạng thái N/A.</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <EquityMetric
          label="Account Equity hiện tại"
          value={latest?.status === "complete" ? formatVnd(latest.equityVnd) : "N/A"}
          detail={latest?.status === "complete" ? latest.key : "Không đủ dữ liệu"}
          title={performanceTermTitle("accountEquity")}
        />
        <EquityMetric
          label="Hiệu suất tài khoản"
          value={formatPercent(equity.accountTotalReturnPercent)}
          detail={metricReason(equity.accountTotalReturnPercent, equity.completeness)}
          title={performanceTermTitle("accountEquity")}
        />
        <EquityMetric
          label="Max Drawdown"
          value={equity.maxDrawdownPercent == null ? "N/A" : `${equity.maxDrawdownPercent.toFixed(2)}%`}
          detail={metricReason(equity.maxDrawdownPercent, equity.completeness)}
          title={performanceTermTitle("drawdown")}
        />
        <EquityMetric
          label="Drawdown trung bình"
          value={equity.averageDrawdownPercent == null ? "N/A" : `${equity.averageDrawdownPercent.toFixed(2)}%`}
          detail={equity.averageDrawdownPercent == null ? "Không đủ dữ liệu" : null}
          title={performanceTermTitle("drawdown")}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
              <Activity className="h-4 w-4 text-cyan-400" /> Điểm Equity gần nhất
            </div>
            <span className="text-[10px] text-slate-600">toàn danh mục</span>
          </div>
          <div className="space-y-2">
            {equity.points.slice(-6).reverse().map((point) => (
              <div key={point.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl border border-white/[0.05] px-3 py-2 text-xs">
                <div className="truncate text-slate-400">{point.key}</div>
                <div className="font-bold tabular-nums text-slate-200">
                  {point.status === "complete" ? formatVnd(point.equityVnd) : "N/A"}
                </div>
                <div className={point.status === "complete" ? "text-emerald-400" : "text-amber-300"}>
                  {point.status === "complete" ? "Đủ" : "Thiếu"}
                </div>
              </div>
            ))}
            {equity.points.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">Không đủ dữ liệu</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-[#090d13] p-4" title={performanceTermTitle("drawdown")}>
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Drawdown episodes gần nhất</div>
          <div className="space-y-2">
            {recentEpisodes.map((episode) => (
              <div key={`${episode.peakKey}:${episode.troughKey}`} className="rounded-xl border border-white/[0.05] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">{episode.peakKey}</span>
                  <span className="font-ticker text-sm font-black tabular-nums text-rose-300">-{episode.depthPercent.toFixed(2)}%</span>
                </div>
                <div className="mt-1 text-[10px] text-slate-600">
                  Đáy {episode.troughKey} · {episode.recovered ? `Hồi phục ${episode.recoveryKey ?? ""}` : "Chưa hồi phục"}
                </div>
              </div>
            ))}
            {recentEpisodes.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500">Chưa có drawdown episode đủ điều kiện.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function EquityMetric({ label, value, detail, title }: { label: string; value: string; detail: string | null; title: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4" title={title}>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="font-ticker text-xl font-black tabular-nums text-white">{value}</div>
      {detail && <div className="mt-1 text-[11px] text-slate-600">{detail}</div>}
    </div>
  )
}
