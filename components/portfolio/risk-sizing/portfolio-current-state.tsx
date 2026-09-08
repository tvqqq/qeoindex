import { AlertTriangle, PieChart } from "lucide-react"

import type { PortfolioPosition } from "@/modules/portfolio/pnl"
import type {
  PortfolioAllocationSnapshot,
  PortfolioRiskCoverage,
} from "@/modules/portfolio/risk-sizing/types"
import { cn } from "@/modules/shared/ui/cn"
import { RiskMetricTooltip } from "./risk-metric-tooltip"
import type { RiskSizingClientContext } from "./use-risk-sizing-context"

interface PortfolioCurrentStateProps {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  allocationSnapshot: PortfolioAllocationSnapshot
  riskCoverage: PortfolioRiskCoverage
  riskContext: RiskSizingClientContext | null
  loadingRiskContext: boolean
  riskContextError: string | null
}

export function PortfolioCurrentState({
  positions,
  currentPrices,
  allocationSnapshot,
  riskCoverage,
  riskContext,
  loadingRiskContext,
  riskContextError,
}: PortfolioCurrentStateProps) {
  const riskContextUnavailable = !loadingRiskContext && riskContext == null

  return (
    <section className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3.5">
        <h3 className="flex items-center gap-2 font-ticker text-sm font-extrabold uppercase tracking-wide text-slate-200 sm:text-base">
          <PieChart className="h-4 w-4 text-blue-400" /> 2. Current Portfolio State
        </h3>
        <span className="font-ticker text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted-2)]">
          {positions.length} holding{positions.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[860px] w-full border-collapse text-left font-ticker text-[11px]">
          <thead>
            <tr className="border-b border-white/10 text-[10px] uppercase tracking-wide text-[var(--color-muted-2)]">
              <th className="px-2 py-2 font-bold">Ticker</th>
              <th className="px-2 py-2 text-right font-bold">Open Qty</th>
              <th className="px-2 py-2 text-right font-bold">Avg Cost</th>
              <th className="px-2 py-2 text-right font-bold">Current Price</th>
              <th className="px-2 py-2 text-right font-bold">Market Value</th>
              <th className="px-2 py-2 text-right font-bold">Unrealized P&amp;L</th>
              <th className="px-2 py-2 font-bold">Stop / Risk Evidence</th>
              <th className="px-2 py-2 text-right font-bold"><RiskMetricTooltip term="activeRisk" /></th>
            </tr>
          </thead>
          <tbody>
            {positions.map((position) => {
              const currentPrice = currentPrices[position.ticker]
              const hasCurrentPrice = Number.isFinite(currentPrice)
              const markPrice = hasCurrentPrice ? currentPrice : position.avgCost
              const marketValueVnd = markPrice * position.openQty * 1000
              const unrealizedPnlVnd = hasCurrentPrice
                ? (currentPrice - position.avgCost) * position.openQty * 1000
                : null
              const holdingRisk = riskCoverage.holdingRisks.find((row) => row.ticker === position.ticker)
              const linkedTradeRisks = riskContext?.openTradeRisks.filter((row) => row.ticker === position.ticker) ?? []
              const knownStops = linkedTradeRisks
                .filter((row) => row.riskStatus === "known" && row.latestStopKvnd != null)
                .map((row) => row.latestStopKvnd as number)

              const evidence = loadingRiskContext
                ? "Loading…"
                : riskContextUnavailable
                  ? "Unavailable"
                  : holdingRisk?.riskStatus === "known"
                    ? knownStops.length > 0
                      ? `${holdingRisk.linkedTradeCount} linked Trade${holdingRisk.linkedTradeCount === 1 ? "" : "s"} · stop ${knownStops.map(formatKvnd).join(", ")}`
                      : `${holdingRisk.linkedTradeCount} linked Trade${holdingRisk.linkedTradeCount === 1 ? "" : "s"} · risk known`
                    : holdingRisk?.linkedTradeCount
                      ? `Risk Unknown · ${holdingRisk.unknownTradeCount} linked Trade${holdingRisk.unknownTradeCount === 1 ? "" : "s"} missing evidence`
                      : "Risk Unknown · unlinked holding"

              const activeRisk = loadingRiskContext
                ? "Loading…"
                : riskContextUnavailable
                  ? "Unavailable"
                  : holdingRisk?.riskStatus === "known"
                    ? formatVnd(holdingRisk.activeRiskVnd)
                    : "Risk Unknown"

              return (
                <tr key={position.ticker} className="border-b border-white/5 text-slate-200 last:border-b-0">
                  <td className="px-2 py-3 font-black text-white">{position.ticker}</td>
                  <td className="px-2 py-3 text-right font-bold">{position.openQty.toLocaleString("vi-VN")}</td>
                  <td className="px-2 py-3 text-right">{formatKvnd(position.avgCost)}</td>
                  <td className="px-2 py-3 text-right">
                    {hasCurrentPrice ? formatKvnd(currentPrice) : <span className="text-amber-300">Missing</span>}
                  </td>
                  <td className="px-2 py-3 text-right font-bold text-purple-200">{formatVnd(marketValueVnd)}</td>
                  <td className={cn("px-2 py-3 text-right font-bold", pnlClass(unrealizedPnlVnd))}>
                    {unrealizedPnlVnd == null ? "—" : formatSignedVnd(unrealizedPnlVnd)}
                  </td>
                  <td className={cn(
                    "px-2 py-3",
                    evidence.includes("Unknown") || evidence === "Unavailable" ? "text-amber-200" : "text-slate-300",
                  )}>
                    {evidence}
                  </td>
                  <td className={cn(
                    "px-2 py-3 text-right font-bold",
                    activeRisk === "Risk Unknown" || activeRisk === "Unavailable" ? "text-amber-200" : "text-slate-100",
                  )}>
                    {activeRisk}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {positions.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/20 p-4 text-center text-xs text-[var(--color-muted-2)]">
          Portfolio hiện không có open holding.
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Stock Market Value" value={formatVnd(allocationSnapshot.stockMarketValueVnd)} />
        <SummaryCard label="Unrealized P&L" value={formatSignedVnd(allocationSnapshot.totalUnrealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalUnrealizedPnlVnd)} />
        <SummaryCard label="Realized P&L" value={formatSignedVnd(allocationSnapshot.totalRealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalRealizedPnlVnd)} />
        <SummaryCard label="Estimated Available Cash" value={formatVnd(allocationSnapshot.estimatedAvailableCashVnd)} valueClassName="text-[var(--color-up)]" />
        <SummaryCard
          label="Known Active Risk"
          value={loadingRiskContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : formatVnd(riskContext?.knownActiveRiskVnd ?? null)}
        />
        <SummaryCard
          label="Unknown Risk Items"
          value={loadingRiskContext ? "Loading…" : riskContextUnavailable ? "Unavailable" : riskCoverage.unknownRiskItemCount.toLocaleString("vi-VN")}
          valueClassName={!loadingRiskContext && !riskContextUnavailable && riskCoverage.unknownRiskItemCount > 0 ? "text-amber-200" : undefined}
        />
      </div>

      {riskContextError ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Risk context unavailable: {riskContextError}. Không suy diễn empty breakdown thành zero Active Risk.</span>
        </div>
      ) : null}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 px-3 py-3">
      <div className="text-[9px] font-bold uppercase tracking-wide text-[var(--color-muted-2)]">{label}</div>
      <div className={cn("mt-1 font-ticker text-xs font-black text-slate-100", valueClassName)}>{value}</div>
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

function formatKvnd(value: number): string {
  return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} k₫`
}

function pnlClass(value: number | null): string {
  if (value == null) return "text-[var(--color-muted-2)]"
  if (value > 0) return "text-[var(--color-up)]"
  if (value < 0) return "text-[var(--color-down)]"
  return "text-slate-100"
}
