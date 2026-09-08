"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RotateCcw, ShieldCheck } from "lucide-react"

import { Input } from "@/components/ui/input"
import type { AccountEquityContext, PortfolioAllocationSnapshot } from "@/modules/portfolio/risk-sizing/types"
import { cn } from "@/modules/shared/ui/cn"
import { RiskMetricTooltip } from "./risk-metric-tooltip"
import type { RiskSizingClientContext } from "./use-risk-sizing-context"

interface PortfolioAllocationAdvisorProps {
  allocationSnapshot: PortfolioAllocationSnapshot
  portfolioAccountEquityContext: AccountEquityContext
  effectiveAccountEquityContext: AccountEquityContext
  manualAccountEquityVnd: number | null
  onManualAccountEquityChange: (valueVnd: number | null) => void
  riskContext: RiskSizingClientContext | null
  loadingRiskContext: boolean
  riskContextError: string | null
  unknownRiskItemCount: number
}

export function PortfolioAllocationAdvisor({
  allocationSnapshot,
  portfolioAccountEquityContext,
  effectiveAccountEquityContext,
  manualAccountEquityVnd,
  onManualAccountEquityChange,
  riskContext,
  loadingRiskContext,
  riskContextError,
  unknownRiskItemCount,
}: PortfolioAllocationAdvisorProps) {
  const [equityInput, setEquityInput] = useState(() => String(Math.round(effectiveAccountEquityContext.valueVnd)))

  useEffect(() => {
    setEquityInput(String(Math.round(effectiveAccountEquityContext.valueVnd)))
  }, [effectiveAccountEquityContext.valueVnd])

  const riskContextUnavailable = !loadingRiskContext && riskContext == null
  const maxActiveRiskVnd = useMemo(() => {
    if (riskContext?.maxActiveRiskPercent == null) return null
    return effectiveAccountEquityContext.valueVnd * (riskContext.maxActiveRiskPercent / 100)
  }, [effectiveAccountEquityContext.valueVnd, riskContext?.maxActiveRiskPercent])
  const remainingRiskBudgetVnd = maxActiveRiskVnd == null || !riskContext
    ? null
    : maxActiveRiskVnd - riskContext.knownActiveRiskVnd

  const equitySourceLabel = manualAccountEquityVnd != null
    ? "Manual"
    : portfolioAccountEquityContext.source === "portfolio_partial"
      ? "Partial"
      : "Portfolio"

  const advisorMessage = loadingRiskContext
    ? "Đang tải Money Management Plan và Active Risk evidence cho portfolio hiện tại."
    : riskContextUnavailable
      ? "Risk context unavailable. Không diễn giải Active Risk hoặc Remaining Risk Budget thành số 0."
      : unknownRiskItemCount > 0
        ? `Có ${unknownRiskItemCount} open Trade/holding chưa đủ canonical risk evidence. Known Active Risk chỉ là phần đã xác định, chưa phải tổng rủi ro portfolio.`
        : effectiveAccountEquityContext.source === "portfolio_partial"
          ? `Account Equity đang partial vì thiếu market price cho ${effectiveAccountEquityContext.missingPriceTickers.join(", ") || "một số ticker"}. Cần review trước khi dùng cap như bằng chứng đầy đủ.`
          : riskContext?.maxActiveRiskPercent == null
            ? "Max Active Risk chưa được cấu hình trong Money Management Plan; có thể xem capacity hiện tại nhưng chưa thể kết luận within plan."
            : `Known Active Risk hiện dùng ${formatPercentOf(riskContext.knownActiveRiskVnd, effectiveAccountEquityContext.valueVnd)} Account Equity; Remaining Risk Budget là ${formatVnd(remainingRiskBudgetVnd)}.`

  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3.5">
        <h3 className="flex items-center gap-2 font-ticker text-sm font-extrabold uppercase tracking-wide text-purple-300 sm:text-base">
          <ShieldCheck className="h-4 w-4" /> 1. Portfolio Allocation Advisor
        </h3>
        <span className="rounded-full border border-purple-500/30 bg-purple-500/15 px-2.5 py-1 font-ticker text-[10px] font-bold uppercase tracking-wide text-purple-300">
          Portfolio scope
        </span>
      </div>

      <div className="mt-4 space-y-3 text-xs">
        <div className="rounded-2xl border border-purple-500/25 bg-purple-500/10 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-1.5 font-bold text-purple-100">
                <RiskMetricTooltip term="accountEquity" />
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-muted-2)]">{equitySourceLabel}</span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-muted-2)]">
                Portfolio mark-to-market có thể được override thủ công khi bạn có Account Equity đã xác nhận từ broker.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onManualAccountEquityChange(null)
                setEquityInput(String(Math.round(portfolioAccountEquityContext.valueVnd)))
              }}
              className={cn(
                "inline-flex items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-[10px] font-bold transition",
                manualAccountEquityVnd == null
                  ? "cursor-default border-white/5 text-[var(--color-muted-2)]"
                  : "border-purple-500/30 text-purple-200 hover:bg-purple-500/10",
              )}
              disabled={manualAccountEquityVnd == null}
            >
              <RotateCcw className="h-3 w-3" /> Use Portfolio
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input
              type="number"
              min="0"
              step="1000000"
              value={equityInput}
              onChange={(event) => {
                const next = event.target.value
                setEquityInput(next)
                const parsed = Number(next)
                onManualAccountEquityChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null)
              }}
              className="h-10 bg-black/35 font-ticker text-sm font-black text-white"
            />
            <span className="font-bold text-[var(--color-muted-2)]">VNĐ</span>
          </div>
        </div>

        <MetricRow label="Initial Capital" value={formatVnd(allocationSnapshot.initialCapitalVnd)} />
        <MetricRow label="Realized P&L" value={formatSignedVnd(allocationSnapshot.totalRealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalRealizedPnlVnd)} />
        <MetricRow label="Unrealized P&L" value={formatSignedVnd(allocationSnapshot.totalUnrealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalUnrealizedPnlVnd)} />
        <MetricRow label="Stock Market Value" value={formatVnd(allocationSnapshot.stockMarketValueVnd)} />
        <MetricRow label="Estimated Available Cash" value={formatVnd(allocationSnapshot.estimatedAvailableCashVnd)} valueClassName="text-[var(--color-up)]" />
        <MetricRow
          labelNode={<RiskMetricTooltip term="riskPerTrade" />}
          value={loadingRiskContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : riskContext ? `${riskContext.defaultTradeRiskPercent.toFixed(2)}%` : "Unavailable"}
        />
        <MetricRow
          labelNode={<RiskMetricTooltip term="activeRisk" />}
          value={loadingRiskContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : formatVnd(riskContext?.knownActiveRiskVnd ?? null)}
        />
        <MetricRow
          labelNode={<RiskMetricTooltip term="maxActiveRisk" />}
          value={loadingRiskContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : maxActiveRiskVnd == null ? "Not configured" : formatVnd(maxActiveRiskVnd)}
        />
        <MetricRow
          labelNode={<RiskMetricTooltip term="remainingRiskBudget" />}
          value={loadingRiskContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : remainingRiskBudgetVnd == null ? "Not configured" : formatVnd(remainingRiskBudgetVnd)}
          valueClassName={remainingRiskBudgetVnd != null && remainingRiskBudgetVnd < 0 ? "text-rose-300" : undefined}
        />
      </div>

      {effectiveAccountEquityContext.source === "portfolio_partial" ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Missing market price: {effectiveAccountEquityContext.missingPriceTickers.join(", ") || "unknown ticker"}. Account Equity và Stock Market Value là partial.</span>
        </div>
      ) : null}

      {riskContextError ? (
        <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
          Risk context unavailable: {riskContextError}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-[11px] leading-relaxed text-slate-300">
        <p className="font-bold uppercase tracking-wide text-purple-200">Portfolio Allocation Advisor</p>
        <p className="mt-1">{advisorMessage}</p>
      </div>
    </section>
  )
}

function MetricRow({
  label,
  labelNode,
  value,
  valueClassName,
}: {
  label?: string
  labelNode?: React.ReactNode
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-1.5 last:border-b-0">
      <span className="text-[var(--color-muted-2)]">{labelNode ?? label}</span>
      <span className={cn("text-right font-ticker font-bold text-slate-100", valueClassName)}>{value}</span>
    </div>
  )
}

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("vi-VN")} VNĐ`
}

function formatSignedVnd(value: number): string {
  return `${value > 0 ? "+" : ""}${formatVnd(value)}`
}

function formatPercentOf(value: number, total: number): string {
  if (!(total > 0)) return "—"
  return `${((value / total) * 100).toFixed(2)}% of`
}

function pnlClass(value: number): string {
  if (value > 0) return "text-[var(--color-up)]"
  if (value < 0) return "text-[var(--color-down)]"
  return "text-slate-100"
}
