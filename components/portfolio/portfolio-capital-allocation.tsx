"use client"

import { memo, useMemo, useState } from "react"
import { Activity, Layers3, Scale } from "lucide-react"

import type { PortfolioMeta } from "@/components/portfolio/portfolio-selector"
import { PortfolioAllocationAdvisor } from "@/components/portfolio/risk-sizing/portfolio-allocation-advisor"
import { PortfolioCurrentState } from "@/components/portfolio/risk-sizing/portfolio-current-state"
import { TradeSizeCalculator } from "@/components/portfolio/risk-sizing/trade-size-calculator"
import { useRiskSizingContext } from "@/components/portfolio/risk-sizing/use-risk-sizing-context"
import type { PortfolioPosition } from "@/modules/portfolio/pnl"
import { buildAccountEquityContext } from "@/modules/portfolio/risk-sizing/calculator"
import {
  buildPortfolioAllocationSnapshot,
  simulatePlannedTrades,
  summarizePortfolioRiskCoverage,
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

  const portfolioAccountEquityContext = useMemo(() => buildAccountEquityContext({
    initialCapitalVnd,
    totalRealizedPnlKvnd,
    positions: positions.map(({ ticker, openQty, avgCost }) => ({ ticker, openQty, avgCost })),
    currentPricesKvnd: currentPrices,
  }), [initialCapitalVnd, totalRealizedPnlKvnd, positions, currentPrices])

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

  if (!activePortfolioId || !activePortfolio) {
    return (
      <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 font-ticker text-sm text-[var(--color-muted-2)]">
        Chọn một portfolio để lập Trade Size plan.
      </div>
    )
  }

  const riskContextUnavailable = !riskSizing.loading && riskSizing.context == null

  return (
    <div className="space-y-6 font-ticker">
      <section className="rounded-3xl border border-[#2a2e40] bg-gradient-to-br from-[#121522] via-[#0d1017] to-[#0d1017] p-6 shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-purple-400">
              <Layers3 className="h-4 w-4" /> Portfolio risk planning workspace
            </div>
            <h2 className="text-xl font-extrabold tracking-tight text-white sm:text-2xl">Capital Allocation &amp; Trade Size</h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-[var(--color-muted-2)] sm:text-sm">
              Portfolio capacity và per-Trade stop-first sizing được tách riêng nhưng dùng chung authenticated risk evidence. Position sizing giới hạn planned loss; gap, liquidity và slippage vẫn có thể làm actual loss vượt planned stop.
            </p>
          </div>
          <div className="grid min-w-[250px] grid-cols-2 gap-2 text-right">
            <HeaderMetric label="Account Equity" value={formatShortVnd(effectiveAccountEquityContext.valueVnd)} />
            <HeaderMetric label="Estimated Cash" value={formatShortVnd(allocationSnapshot.estimatedAvailableCashVnd)} emphasis />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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

        <section className="min-w-0 rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3.5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-amber-300 sm:text-base">
              <Scale className="h-4 w-4" /> 3. Trade Size Advisor
            </h3>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-200">Per Trade</span>
          </div>
          <TradeSizeCalculator
            accountEquityContext={effectiveAccountEquityContext}
            riskContext={riskSizing.context}
            loadingContext={riskSizing.loading}
            contextError={riskSizing.error}
          />
        </section>

        <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3.5">
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-emerald-300 sm:text-base">
              <Activity className="h-4 w-4" /> 4. Combined Portfolio Simulation
            </h3>
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200">Before → After</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SimulationMetric label="Current Account Equity" value={formatVnd(effectiveAccountEquityContext.valueVnd)} />
            <SimulationMetric label="Estimated Available Cash" value={formatVnd(allocationSnapshot.estimatedAvailableCashVnd)} />
            <SimulationMetric
              label="Known Active Risk"
              value={riskSizing.loading ? "Loading…" : riskContextUnavailable ? "Unavailable" : formatVnd(riskSizing.context?.knownActiveRiskVnd ?? null)}
            />
            <SimulationMetric
              label="Unknown Risk Items"
              value={riskSizing.loading ? "Loading…" : riskContextUnavailable ? "Unavailable" : riskCoverage.unknownRiskItemCount.toLocaleString("vi-VN")}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-xs leading-relaxed text-slate-300">
            <p className="font-bold uppercase tracking-wide text-emerald-200">Combined Verdict</p>
            <p className="mt-1 font-black text-white">{riskSizing.loading ? "Loading…" : combinedSimulation.verdict}</p>
            <p className="mt-2 text-[11px] text-[var(--color-muted-2)]">
              Planned basket hiện chưa được thêm từ Trade Size Advisor. Không tạo synthetic margin hoặc planned risk để lấp chỗ trống; Task kế tiếp sẽ nối per-ticker planned Trades vào cùng simulation domain.
            </p>
          </div>

          {plannedTrades.length > 0 ? (
            <button
              type="button"
              onClick={() => setPlannedTrades([])}
              className="mt-4 rounded-xl border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted-2)] transition hover:bg-white/5 hover:text-white"
            >
              Clear planned basket
            </button>
          ) : null}
        </section>
      </div>
    </div>
  )
})

function HeaderMetric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={emphasis
      ? "rounded-2xl border border-purple-500/30 bg-purple-500/10 px-3 py-2"
      : "rounded-2xl border border-white/[0.08] bg-black/30 px-3 py-2"}
    >
      <span className="block text-[9px] font-bold uppercase tracking-wide text-[var(--color-muted-2)]">{label}</span>
      <span className={emphasis ? "text-sm font-black text-[var(--color-up)]" : "text-sm font-black text-white"}>{value}</span>
    </div>
  )
}

function SimulationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-3">
      <div className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-muted-2)]">{label}</div>
      <div className="mt-1 text-xs font-black text-slate-100">{value}</div>
    </div>
  )
}

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("vi-VN")} VNĐ`
}

function formatShortVnd(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} tr`
  return `${Math.round(value).toLocaleString("vi-VN")} đ`
}
