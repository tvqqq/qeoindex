"use client"

import { CircleHelp, Gauge, ReceiptText, Target } from "lucide-react"

import type { MetricValue, TradingScorecard as TradingScorecardModel } from "@/modules/portfolio/performance/types"
import { PERFORMANCE_TERMINOLOGY, performanceTermTitle } from "./terminology"

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${Math.round(value).toLocaleString("vi-VN")} ₫`
}

function formatPercent(metric: MetricValue): string {
  if (metric.value == null) return "N/A"
  return `${metric.value >= 0 ? "+" : ""}${metric.value.toFixed(2)}%`
}

function formatRatio(metric: MetricValue): string {
  if (metric.value == null) return "N/A"
  return metric.value.toFixed(2)
}

function MetricCard({
  label,
  value,
  detail,
  title,
}: {
  label: string
  value: string
  detail?: string | null
  title?: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4" title={title}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
        <span>{label}</span>
        {title && <CircleHelp className="h-3.5 w-3.5 text-slate-600" />}
      </div>
      <div className="font-ticker text-xl font-black tabular-nums text-white">{value}</div>
      {detail && <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{detail}</div>}
    </div>
  )
}

export function TradingScorecard({ card }: { card: TradingScorecardModel }) {
  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-3 border-b border-white/[0.07] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-purple-400">
            <Gauge className="h-4 w-4" /> Trading Scorecard
          </div>
          <h2 className="font-ticker text-lg font-black text-white">Bảng điểm giao dịch</h2>
          <p className="mt-1 text-xs text-slate-500">Đơn vị thống kê là Trade logic đã đóng, không phải từng fill.</p>
        </div>
        <div className="rounded-full border border-purple-500/25 bg-purple-500/10 px-3 py-1.5 text-xs font-bold text-purple-300">
          {card.eligibleTradeCount} Trade đủ điều kiện
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={PERFORMANCE_TERMINOLOGY.winRatio.labelVi}
          value={formatPercent(card.winRatioPercent)}
          detail={card.winRatioPercent.reason}
          title={performanceTermTitle("winRatio")}
        />
        <MetricCard
          label={PERFORMANCE_TERMINOLOGY.payoffRatio.labelVi}
          value={formatRatio(card.payoffRatio)}
          detail={card.payoffRatio.reason}
          title={performanceTermTitle("payoffRatio")}
        />
        <MetricCard
          label={PERFORMANCE_TERMINOLOGY.commissionRatio.labelVi}
          value={card.commissionRatio.value == null ? "N/A" : `${(card.commissionRatio.value * 100).toFixed(2)}%`}
          detail={card.commissionRatio.reason}
          title={performanceTermTitle("commissionRatio")}
        />
        <MetricCard
          label={PERFORMANCE_TERMINOLOGY.documentedPnl.labelVi}
          value={formatPercent(card.documentedPnlPercent)}
          detail={card.documentedPnlPercent.reason}
          title={performanceTermTitle("documentedPnl")}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Lãi gộp" value={formatVnd(card.grossProfitVnd)} />
        <MetricCard label="Lỗ gộp" value={formatVnd(card.grossLossVnd)} />
        <MetricCard label="Tổng phí" value={formatVnd(card.commissionVnd)} />
        <MetricCard label="Lãi/lỗ ròng" value={formatVnd(card.netPnlVnd)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <Target className="h-4 w-4 text-emerald-400" /> Chất lượng Trade
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <Stat label="Thắng" value={String(card.winnerCount)} />
            <Stat label="Thua" value={String(card.loserCount)} />
            <Stat label="Hòa vốn" value={String(card.breakevenCount)} />
            <Stat label="Lời TB" value={card.averageWinVnd.value == null ? "N/A" : formatVnd(card.averageWinVnd.value)} />
            <Stat label="Lỗ TB" value={card.averageLossVnd.value == null ? "N/A" : formatVnd(card.averageLossVnd.value)} />
            <Stat label="Lời lớn nhất" value={card.largestWinVnd.value == null ? "N/A" : formatVnd(card.largestWinVnd.value)} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
            <ReceiptText className="h-4 w-4 text-amber-300" /> Chuỗi thua
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <Stat label="Lỗ lớn nhất" value={card.largestLossVnd.value == null ? "N/A" : formatVnd(card.largestLossVnd.value)} />
            <Stat label="Chuỗi thua dài nhất" value={card.largestConsecutiveLosses.value == null ? "N/A" : `${card.largestConsecutiveLosses.value} Trade`} />
            <Stat label="Chuỗi thua trung bình" value={card.averageConsecutiveLosses.value == null ? "N/A" : card.averageConsecutiveLosses.value.toFixed(2)} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.07] bg-[#090d13] p-4">
          <div className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">25 Trade gần nhất</div>
          <div className="font-ticker text-2xl font-black text-white">
            {card.rolling25.netPnlVnd == null ? "N/A" : formatVnd(card.rolling25.netPnlVnd)}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span>{card.rolling25.sampleSize}/25 Trade</span>
            <span>•</span>
            <span>{card.rolling25.isFullWindow ? "Đủ cửa sổ" : "Chưa đủ cửa sổ"}</span>
            <span>•</span>
            <span>{card.rolling25.status}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-slate-600">{label}</div>
      <div className="mt-0.5 font-bold tabular-nums text-slate-200">{value}</div>
    </div>
  )
}
