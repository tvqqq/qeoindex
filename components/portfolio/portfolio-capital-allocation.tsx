"use client"

import { memo, useMemo, useState } from "react"
import { Layers3, Scale } from "lucide-react"

import type { PortfolioMeta } from "@/components/portfolio/portfolio-selector"
import { CombinedPortfolioSimulation } from "@/components/portfolio/risk-sizing/combined-portfolio-simulation"
import { PortfolioAllocationAdvisor } from "@/components/portfolio/risk-sizing/portfolio-allocation-advisor"
import { PortfolioCurrentState } from "@/components/portfolio/risk-sizing/portfolio-current-state"
import { TradeSizeAdvisor } from "@/components/portfolio/risk-sizing/trade-size-advisor"
import { useRiskSizingContext } from "@/components/portfolio/risk-sizing/use-risk-sizing-context"
import type { PortfolioPosition } from "@/modules/portfolio/pnl"
import {
  buildPortfolioAllocationSnapshot,
  removePlannedTrade,
  simulatePlannedTrades,
  summarizePortfolioRiskCoverage,
  upsertPlannedTrade,
} from "@/modules/portfolio/risk-sizing/planning"
import type { AccountEquityContext, PlannedTrade } from "@/modules/portfolio/risk-sizing/types"

interface PortfolioCapitalAllocationProps {
  portfolios: PortfolioMeta[]
  activePortfolioId: string
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  totalRealizedPnlKvnd: number
}

export const PortfolioCapitalAllocation = memo(function PortfolioCapitalAllocation({
  portfolios,
  activePortfolioId,
  positions,
  currentPrices,
  totalRealizedPnlKvnd,
}: PortfolioCapitalAllocationProps) {
  const activePortfolio = portfolios.find((portfolio) => portfolio.id === activePortfolioId)
  const initialCapitalVnd = Number(activePortfolio?.initial_capital ?? 0)
  const riskSizing = useRiskSizingContext(activePortfolioId)
  const [manualAccountEquityVnd, setManualAccountEquityVnd] = useState<number | null>(null)
  const [plannedTrades, setPlannedTrades] = useState<PlannedTrade[]>([])

  const portfolioAccountEquityContext = useMemo<AccountEquityContext>(() => {
    const canonical = riskSizing.context
    if (canonical?.accountEquityVnd != null && canonical.accountEquityCompleteness === "complete") {
      return {
        valueVnd: canonical.accountEquityVnd,
        source: "portfolio_mark_to_market",
        missingPriceTickers: [],
      }
    }
    return {
      valueVnd: canonical?.accountEquityVnd ?? initialCapitalVnd,
      source: "portfolio_partial",
      missingPriceTickers: canonical?.accountEquityMissingPriceTickers ?? positions.map(({ ticker }) => ticker),
    }
  }, [initialCapitalVnd, positions, riskSizing.context])

  const effectiveAccountEquityContext: AccountEquityContext = manualAccountEquityVnd != null
    ? { valueVnd: manualAccountEquityVnd, source: "manual", missingPriceTickers: [] }
    : portfolioAccountEquityContext

  const allocationSnapshot = useMemo(() => buildPortfolioAllocationSnapshot({
    initialCapitalVnd,
    totalRealizedPnlKvnd,
    positions: positions.map(({ ticker, openQty, avgCost, totalInvested }) => ({
      ticker,
      openQty,
      avgCost,
      totalInvested,
    })),
    currentPricesKvnd: currentPrices,
  }), [initialCapitalVnd, totalRealizedPnlKvnd, positions, currentPrices])

  const riskCoverage = useMemo(() => summarizePortfolioRiskCoverage({
    positions: positions.map(({ ticker }) => ({ ticker })),
    openTradeRisks: riskSizing.context?.openTradeRisks ?? [],
  }), [positions, riskSizing.context?.openTradeRisks])

  const combinedSimulation = useMemo(() => simulatePlannedTrades({
    accountEquityVnd: effectiveAccountEquityContext.valueVnd,
    accountEquityComplete: effectiveAccountEquityContext.source !== "portfolio_partial",
    estimatedAvailableCashVnd: allocationSnapshot.estimatedAvailableCashVnd,
    knownActiveRiskVnd: riskSizing.context?.knownActiveRiskVnd ?? 0,
    maxActiveRiskPercent: riskSizing.context?.maxActiveRiskPercent ?? null,
    unknownRiskItemCount: riskCoverage.unknownRiskItemCount,
    riskContextAvailable: riskSizing.context != null,
    plannedTrades,
  }), [
    allocationSnapshot.estimatedAvailableCashVnd,
    effectiveAccountEquityContext.source,
    effectiveAccountEquityContext.valueVnd,
    plannedTrades,
    riskCoverage.unknownRiskItemCount,
    riskSizing.context,
  ])

  const currentRemainingRiskBudgetVnd = combinedSimulation.maxActiveRiskVnd == null || riskSizing.context == null
    ? null
    : combinedSimulation.maxActiveRiskVnd - riskSizing.context.knownActiveRiskVnd

  if (!activePortfolioId || !activePortfolio) {
    return (
      <div className="rounded-[28px] border border-white/[0.08] bg-[#0b0e15] p-6 font-ticker text-sm text-[var(--color-muted-2)] shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        Chọn một danh mục để lập kế hoạch khối lượng giao dịch.
      </div>
    )
  }

  return (
    <div data-planner-workspace className="space-y-5 font-ticker">
      <section className="relative overflow-hidden rounded-[30px] border border-purple-500/20 bg-gradient-to-br from-[#17142a] via-[#10131d] to-[#0a0d13] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.34)] ring-1 ring-white/[0.04] sm:p-6">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-purple-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-purple-400/20 bg-purple-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-purple-200">
                <Layers3 className="h-3.5 w-3.5" /> Lập kế hoạch phân bổ vốn
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-bold text-slate-300">
                {activePortfolio.name}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[10px] font-bold text-slate-400">
                {positions.length} khoản đang nắm giữ
              </span>
            </div>
            <h2 className="text-2xl font-black tracking-[-0.025em] text-white sm:text-3xl">Phân bổ vốn &amp; khối lượng giao dịch</h2>
            <p className="mt-2 max-w-2xl text-[11px] leading-relaxed text-slate-400 sm:text-xs">
              Một không gian chung để xem sức chứa danh mục, tính khối lượng theo mức dừng lỗ và mô phỏng kế hoạch cộng dồn. Dữ liệu rủi ro được dùng chung; mức lỗ dự kiến không bảo đảm mức lỗ thực tế khi khớp lệnh.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-wide text-slate-400">
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5">1 · Sức chứa</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5">2 · Danh mục hiện tại</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5">3 · Khối lượng giao dịch</span>
              <span className="rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-1.5">4 · Mô phỏng</span>
            </div>
          </div>

          <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-auto xl:min-w-[360px]">
            <HeaderMetric label="Vốn tài khoản" value={formatShortVnd(effectiveAccountEquityContext.valueVnd)} />
            <HeaderMetric label="Tiền mặt ước tính" value={formatShortVnd(allocationSnapshot.estimatedAvailableCashVnd)} emphasis />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <PortfolioAllocationAdvisor
          allocationSnapshot={allocationSnapshot}
          portfolioAccountEquityContext={portfolioAccountEquityContext}
          effectiveAccountEquityContext={effectiveAccountEquityContext}
          manualAccountEquityVnd={manualAccountEquityVnd}
          onManualAccountEquityChange={setManualAccountEquityVnd}
          riskContext={riskSizing.context}
          loadingRiskContext={riskSizing.loading}
          riskContextError={riskSizing.error}
          unknownRiskItemCount={riskCoverage.unknownRiskItemCount}
        />

        <PortfolioCurrentState
          positions={positions}
          currentPrices={currentPrices}
          allocationSnapshot={allocationSnapshot}
          riskCoverage={riskCoverage}
          riskContext={riskSizing.context}
          loadingRiskContext={riskSizing.loading}
          riskContextError={riskSizing.error}
        />

        <section className="min-w-0 overflow-hidden rounded-[28px] border border-amber-500/15 bg-gradient-to-b from-[#111018] to-[#0a0d13] p-4 shadow-[0_18px_55px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.035] sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-amber-400/70">Tính khối lượng vị thế</p>
              <h3 className="mt-1 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-amber-200 sm:text-base">
                <Scale className="h-4 w-4" /> 3. Tư vấn khối lượng giao dịch
              </h3>
            </div>
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-amber-200">Theo từng giao dịch</span>
          </div>
          <TradeSizeAdvisor
            accountEquityContext={effectiveAccountEquityContext}
            riskContext={riskSizing.context}
            loadingRiskContext={riskSizing.loading}
            riskContextError={riskSizing.error}
            plannedTrades={plannedTrades}
            onUpsertPlannedTrade={(trade) => setPlannedTrades((rows) => upsertPlannedTrade(rows, trade))}
            onRemovePlannedTrade={(ticker) => setPlannedTrades((rows) => removePlannedTrade(rows, ticker))}
          />
        </section>

        <CombinedPortfolioSimulation
          accountEquityVnd={effectiveAccountEquityContext.valueVnd}
          estimatedAvailableCashVnd={allocationSnapshot.estimatedAvailableCashVnd}
          stockMarketValueVnd={allocationSnapshot.stockMarketValueVnd}
          knownActiveRiskVnd={riskSizing.context?.knownActiveRiskVnd ?? null}
          currentRemainingRiskBudgetVnd={currentRemainingRiskBudgetVnd}
          plannedTrades={plannedTrades}
          simulation={combinedSimulation}
          loadingRiskContext={riskSizing.loading}
          riskContextAvailable={riskSizing.context != null}
          riskContextError={riskSizing.error}
          onClearPlannedTrades={() => setPlannedTrades([])}
        />
      </div>
    </div>
  )
})

function HeaderMetric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={emphasis
      ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-3"
      : "rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3"}
    >
      <span className="block text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <span className={emphasis ? "mt-1 block text-lg font-black text-emerald-300" : "mt-1 block text-lg font-black text-white"}>{value}</span>
    </div>
  )
}

function formatShortVnd(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`
  return `${Math.round(value).toLocaleString("vi-VN")} đ`
}
