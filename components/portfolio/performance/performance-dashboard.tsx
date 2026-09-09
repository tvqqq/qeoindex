"use client"

import { useState } from "react"
import { AlertTriangle, BarChart3, RefreshCw, Sigma } from "lucide-react"

import type { PerformancePopulation } from "@/modules/portfolio/performance/types"
import { TradingScorecard } from "./trading-scorecard"
import { EquityDrawdownPanel } from "./equity-drawdown-panel"
import { PerformanceLedger, type PerformancePeriod } from "./performance-ledger"
import { BenchmarkPanel } from "./benchmark-panel"
import { SegmentsPanel } from "./segments-panel"
import { PERFORMANCE_TERMINOLOGY, performanceTermTitle } from "./terminology"
import { usePortfolioPerformance } from "./use-performance"

const POPULATION_OPTIONS: Array<{ value: PerformancePopulation; label: string }> = [
  { value: "live", label: "Thực tế" },
  { value: "paper", label: "Mô phỏng" },
  { value: "combined", label: "Kết hợp" },
]

const PERIOD_OPTIONS: Array<{ value: PerformancePeriod; label: string }> = [
  { value: "daily", label: "Ngày" },
  { value: "weekly", label: "Tuần" },
  { value: "monthly", label: "Tháng" },
  { value: "annual", label: "Năm" },
]

export function PortfolioPerformanceDashboard({ portfolioId }: { portfolioId: string }) {
  const { data, loading, error, refresh } = usePortfolioPerformance(portfolioId)
  const [population, setPopulation] = useState<PerformancePopulation>("live")
  const [period, setPeriod] = useState<PerformancePeriod>("monthly")

  if (loading && !data) {
    return <PerformanceLoading />
  }

  if (error && !data) {
    return (
      <div className="rounded-3xl border border-rose-500/25 bg-rose-500/[0.06] p-8 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-rose-300" />
        <div className="mt-3 font-ticker text-base font-bold text-white">Không thể tải hiệu suất</div>
        <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-4 rounded-full border border-white/[0.1] bg-white/[0.04] px-4 py-2 text-xs font-bold text-slate-200 hover:bg-white/[0.07]"
        >
          Thử lại
        </button>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-10 text-center">
        <BarChart3 className="mx-auto h-8 w-8 text-slate-700" />
        <div className="mt-3 font-bold text-slate-300">Không đủ dữ liệu</div>
      </div>
    )
  }

  const scorecard = data.scorecards[population]
  const tradingLedgers = data.tradingLedgers[population]
  const segments = data.segments[population]
  const optimalF = scorecard.optimalF

  return (
    <div className="space-y-5 font-ticker">
      <div className="rounded-3xl border border-[#2b2e40] bg-gradient-to-r from-[#0d1017] via-[#121425] to-[#0d1017] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-purple-400">Campaign Results · Canonical Performance</div>
            <h2 className="font-ticker text-xl font-black text-white sm:text-2xl">Kết quả chiến dịch · Hiệu suất danh mục &amp; chất lượng giao dịch</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Bộ lọc Trade chỉ thay đổi Scorecard, Trading Ledger và Segmentation. Account Equity, Drawdown và benchmark luôn là số liệu <strong className="text-slate-300">toàn danh mục</strong>.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <ControlGroup label="Phạm vi Trade">
              {POPULATION_OPTIONS.map((option) => (
                <ControlButton
                  key={option.value}
                  active={population === option.value}
                  onClick={() => setPopulation(option.value)}
                >
                  {option.label}
                </ControlButton>
              ))}
            </ControlGroup>
            <ControlGroup label="Chu kỳ Ledger">
              {PERIOD_OPTIONS.map((option) => (
                <ControlButton
                  key={option.value}
                  active={period === option.value}
                  onClick={() => setPeriod(option.value)}
                >
                  {option.label}
                </ControlButton>
              ))}
            </ControlGroup>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-white/[0.09] bg-white/[0.035] px-3 text-xs font-bold text-slate-400 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Làm mới
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <EvidencePill label="Trade đủ điều kiện" value={String(data.evidence.eligibleTradeCount)} />
          <EvidencePill label="Trade đóng bị loại" value={String(data.evidence.excludedClosedTradeCount)} />
          <EvidencePill label="Giao dịch legacy chưa nhóm" value={String(data.evidence.legacyUngroupedTransactionCount)} />
        </div>

        <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-[11px] leading-relaxed text-amber-100/65">
          <strong className="text-amber-200">Mẫu nhỏ:</strong> Win Ratio, Payoff Ratio và phân nhóm có thể dao động mạnh khi lịch sử Trade còn ít. Đây là bằng chứng mô tả lịch sử, không phải xác nhận một hệ thống có lợi thế.
        </div>
      </div>

      <TradingScorecard card={scorecard} />
      <EquityDrawdownPanel equity={data.equity} />
      <PerformanceLedger trading={tradingLedgers} account={data.accountLedgers} period={period} />
      <BenchmarkPanel benchmark={data.benchmark} />
      <SegmentsPanel segments={segments} />

      <section className="rounded-3xl border border-purple-500/20 bg-gradient-to-br from-purple-950/20 to-[#0c1017] p-5 shadow-sm sm:p-6" title={performanceTermTitle("optimalF")}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-purple-400">
              <Sigma className="h-4 w-4" /> Advanced Optimal f
            </div>
            <h2 className="font-ticker text-lg font-black text-white">{PERFORMANCE_TERMINOLOGY.optimalF.labelVi}</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
              {PERFORMANCE_TERMINOLOGY.optimalF.helpVi} Công thức và thuật ngữ gốc có trong tooltip.
            </p>
          </div>
          <div className="min-w-36 rounded-2xl border border-purple-500/20 bg-purple-500/[0.06] px-5 py-4 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400/70">Optimal f</div>
            <div className="mt-1 font-ticker text-3xl font-black tabular-nums text-purple-200">
              {optimalF.value == null ? "N/A" : optimalF.value.toFixed(3)}
            </div>
            {optimalF.value == null && (
              <div className="mt-1 text-[10px] text-slate-600">{optimalF.reason ?? "Không đủ dữ liệu"}</div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</div>
      <div className="inline-flex rounded-xl border border-white/[0.08] bg-[#080b10] p-1">{children}</div>
    </div>
  )
}

function ControlButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${active ? "bg-purple-500/20 text-purple-200 shadow-sm" : "text-slate-500 hover:text-slate-200"}`}
    >
      {children}
    </button>
  )
}

function EvidencePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-[11px]">
      <span className="text-slate-600">{label}</span>
      <span className="font-bold tabular-nums text-slate-300">{value}</span>
    </div>
  )
}

function PerformanceLoading() {
  return (
    <div className="space-y-4">
      <div className="h-40 animate-pulse rounded-3xl border border-[#2a2e40] bg-white/[0.025]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-2xl border border-[#2a2e40] bg-white/[0.025]" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-3xl border border-[#2a2e40] bg-white/[0.025]" />
    </div>
  )
}
