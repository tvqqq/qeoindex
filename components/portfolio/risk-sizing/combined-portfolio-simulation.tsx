"use client"

import { Activity, AlertTriangle } from "lucide-react"

import {
  describePortfolioAdvisor,
  describeTradeAdvisor,
} from "@/modules/portfolio/risk-sizing/planning"
import type {
  PlannedTrade,
  PortfolioPlanSimulation,
} from "@/modules/portfolio/risk-sizing/types"
import { cn } from "@/modules/shared/ui/cn"

export function CombinedPortfolioSimulation({
  accountEquityVnd,
  estimatedAvailableCashVnd,
  stockMarketValueVnd,
  knownActiveRiskVnd,
  currentRemainingRiskBudgetVnd,
  plannedTrades,
  simulation,
  loadingRiskContext,
  riskContextAvailable,
  riskContextError,
  onClearPlannedTrades,
}: {
  accountEquityVnd: number
  estimatedAvailableCashVnd: number
  stockMarketValueVnd: number
  knownActiveRiskVnd: number | null
  currentRemainingRiskBudgetVnd: number | null
  plannedTrades: PlannedTrade[]
  simulation: PortfolioPlanSimulation
  loadingRiskContext: boolean
  riskContextAvailable: boolean
  riskContextError: string | null
  onClearPlannedTrades: () => void
}) {
  const portfolioAdvisorMessage = loadingRiskContext
    ? "Loading portfolio risk evidence…"
    : describePortfolioAdvisor(simulation)
  const tradeAdvisorMessage = describeTradeAdvisor(plannedTrades)
  const verdict = loadingRiskContext ? "Loading…" : simulation.verdict

  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3.5">
        <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-emerald-300 sm:text-base">
          <Activity className="h-4 w-4" /> 4. Combined Portfolio Simulation
        </h3>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-200">
          Before → After
        </span>
      </div>

      {riskContextError ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Risk context unavailable: {riskContextError}</span>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <StateColumn title="Before">
          <Metric label="Account Equity" value={formatVnd(accountEquityVnd)} />
          <Metric label="Estimated Available Cash" value={formatVnd(estimatedAvailableCashVnd)} />
          <Metric label="Stock Market Value" value={formatVnd(stockMarketValueVnd)} />
          <Metric
            label="Known Active Risk"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: knownActiveRiskVnd })}
          />
          <Metric
            label="Remaining Risk Budget"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: currentRemainingRiskBudgetVnd, notConfiguredWhenNull: true })}
          />
        </StateColumn>

        <StateColumn title="Planned">
          <Metric label="Planned Trades" value={plannedTrades.length.toLocaleString("vi-VN")} />
          <Metric label="Position Value" value={formatVnd(simulation.plannedPositionValueVnd)} />
          <Metric label="Risk Added" value={formatVnd(simulation.plannedRiskAddedVnd)} />
        </StateColumn>

        <StateColumn title="After">
          <Metric label="Projected Estimated Cash" value={formatVnd(simulation.projectedEstimatedCashVnd)} />
          <Metric
            label="Projected Active Risk"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: simulation.projectedKnownActiveRiskVnd })}
          />
          <Metric
            label="Projected Risk %"
            value={loadingRiskContext
              ? "Loading…"
              : !riskContextAvailable
                ? "Unavailable"
                : formatPercent(simulation.projectedRiskPercent)}
          />
          <Metric
            label="Remaining Risk Budget"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: simulation.remainingRiskBudgetVnd, notConfiguredWhenNull: true })}
          />
          <Metric label="Funding Gap" value={formatVnd(simulation.fundingGapVnd)} warning={simulation.fundingGapVnd > 0} />
        </StateColumn>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <AdvisorMessage
          title="Portfolio Allocation Advisor"
          message={portfolioAdvisorMessage}
          warning={!loadingRiskContext && simulation.verdict !== "WITHIN PLAN"}
        />
        <AdvisorMessage title="Trade Size Advisor" message={tradeAdvisorMessage} />
      </div>

      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-black/25 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-muted-2)]">Combined Verdict</p>
            <p className={cn(
              "mt-1 text-base font-black",
              verdict === "WITHIN PLAN" && "text-emerald-300",
              verdict === "EXCEEDS PLAN" && "text-rose-300",
              (verdict === "RISK UNKNOWN" || verdict === "REVIEW REQUIRED") && "text-amber-300",
              verdict === "UNAVAILABLE" && "text-slate-300",
              verdict === "Loading…" && "text-slate-300",
            )}>
              {verdict}
            </p>
          </div>
          {plannedTrades.length > 0 ? (
            <button
              type="button"
              onClick={onClearPlannedTrades}
              className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted-2)] transition hover:bg-white/5 hover:text-white"
            >
              Clear planned basket
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function StateColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <h4 className="text-[11px] font-black uppercase tracking-[0.16em] text-white">{title}</h4>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  )
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 last:border-b-0">
      <span className="text-[10px] text-[var(--color-muted-2)]">{label}</span>
      <span className={cn("text-right text-[11px] font-bold text-slate-100", warning && "text-amber-300")}>{value}</span>
    </div>
  )
}

function AdvisorMessage({ title, message, warning = false }: { title: string; message: string; warning?: boolean }) {
  return (
    <div className={cn(
      "rounded-2xl border p-4 text-[11px] leading-relaxed",
      warning
        ? "border-amber-500/20 bg-amber-500/[0.06] text-amber-100"
        : "border-white/[0.07] bg-black/20 text-slate-300",
    )}>
      <p className="font-bold uppercase tracking-wide text-white">{title}</p>
      <p className="mt-1">{message}</p>
    </div>
  )
}

function riskValue({
  loadingRiskContext,
  riskContextAvailable,
  valueVnd,
  notConfiguredWhenNull = false,
}: {
  loadingRiskContext: boolean
  riskContextAvailable: boolean
  valueVnd: number | null
  notConfiguredWhenNull?: boolean
}): string {
  if (loadingRiskContext) return "Loading…"
  if (!riskContextAvailable) return "Unavailable"
  if (valueVnd == null) return notConfiguredWhenNull ? "Not configured" : "—"
  return formatVnd(valueVnd)
}

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("vi-VN")} VNĐ`
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`
}
