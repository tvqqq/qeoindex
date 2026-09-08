import type { ReactNode } from "react"
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
    <section
      data-planner-panel="current-state"
      className="overflow-hidden rounded-[28px] border border-blue-500/15 bg-gradient-to-b from-[#0f131b] to-[#0a0d13] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.035]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-blue-400/70">Các khoản đang nắm giữ</p>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-slate-100 sm:text-base">
            <PieChart className="h-4 w-4 text-blue-400" /> 2. Trạng thái danh mục hiện tại
          </h3>
        </div>
        <span className="rounded-full border border-blue-500/20 bg-blue-500/[0.08] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-blue-200">
          {positions.length} khoản nắm giữ
        </span>
      </div>

      {positions.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/[0.08] bg-black/15 p-6 text-center text-xs text-slate-500">
          Danh mục hiện không có khoản nắm giữ đang mở.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
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
              ? "Đang tải…"
              : riskContextUnavailable
                ? "Không khả dụng"
                : holdingRisk?.riskStatus === "known"
                  ? knownStops.length > 0
                    ? `${holdingRisk.linkedTradeCount} giao dịch đã liên kết · dừng lỗ ${knownStops.map(formatKvnd).join(", ")}`
                    : `${holdingRisk.linkedTradeCount} giao dịch đã liên kết · rủi ro đã xác định`
                  : holdingRisk?.linkedTradeCount
                    ? `Rủi ro chưa xác định · ${holdingRisk.unknownTradeCount} giao dịch liên kết thiếu bằng chứng`
                    : "Rủi ro chưa xác định · khoản nắm giữ chưa liên kết giao dịch"

            const activeRisk = loadingRiskContext
              ? "Đang tải…"
              : riskContextUnavailable
                ? "Không khả dụng"
                : holdingRisk?.riskStatus === "known"
                  ? formatVnd(holdingRisk.activeRiskVnd)
                  : "Rủi ro chưa xác định"

            const riskNeedsReview = activeRisk === "Rủi ro chưa xác định" || activeRisk === "Không khả dụng"

            return (
              <article key={position.ticker} className="rounded-2xl border border-white/[0.07] bg-black/20 p-4 transition-colors hover:border-white/[0.11]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-400/[0.08] text-sm font-black text-blue-100">
                      {position.ticker.slice(0, 3)}
                    </div>
                    <div>
                      <p className="text-base font-black tracking-wide text-white">{position.ticker}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{position.openQty.toLocaleString("vi-VN")} cổ phiếu đang mở · Giá vốn bình quân {formatKvnd(position.avgCost)}</p>
                    </div>
                  </div>
                  <span className={cn(
                    "w-fit rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-wide",
                    riskNeedsReview
                      ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
                      : "border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-200",
                  )}>
                    {loadingRiskContext ? "Đang tải" : riskNeedsReview ? activeRisk : "Rủi ro đã xác định"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <HoldingMetric label="Giá hiện tại" value={hasCurrentPrice ? formatKvnd(currentPrice) : "Thiếu dữ liệu"} warning={!hasCurrentPrice} />
                  <HoldingMetric label="Giá trị thị trường" value={formatVnd(marketValueVnd)} />
                  <HoldingMetric label="Lãi/lỗ chưa thực hiện" value={unrealizedPnlVnd == null ? "—" : formatSignedVnd(unrealizedPnlVnd)} valueClassName={pnlClass(unrealizedPnlVnd)} />
                  <HoldingMetric labelNode={<RiskMetricTooltip term="activeRisk" />} value={activeRisk} warning={riskNeedsReview} />
                </div>

                <div className={cn(
                  "mt-3 rounded-xl border px-3 py-2.5 text-[10px] leading-relaxed",
                  evidence.includes("chưa xác định") || evidence === "Không khả dụng"
                    ? "border-amber-500/15 bg-amber-500/[0.06] text-amber-100"
                    : "border-white/[0.06] bg-black/20 text-slate-400",
                )}>
                  <span className="font-black uppercase tracking-wide text-slate-500">Bằng chứng dừng lỗ / rủi ro · </span>
                  {evidence}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Giá trị thị trường cổ phiếu" value={formatVnd(allocationSnapshot.stockMarketValueVnd)} />
        <SummaryCard label="Lãi/lỗ chưa thực hiện" value={formatSignedVnd(allocationSnapshot.totalUnrealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalUnrealizedPnlVnd)} />
        <SummaryCard label="Lãi/lỗ đã thực hiện" value={formatSignedVnd(allocationSnapshot.totalRealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalRealizedPnlVnd)} />
        <SummaryCard label="Tiền mặt khả dụng ước tính" value={formatVnd(allocationSnapshot.estimatedAvailableCashVnd)} valueClassName="text-emerald-300" />
        <SummaryCard
          label="Rủi ro đang hoạt động đã biết"
          value={loadingRiskContext ? "Đang tải…" : riskContextUnavailable ? "Không khả dụng" : formatVnd(riskContext?.knownActiveRiskVnd ?? null)}
        />
        <SummaryCard
          label="Mục rủi ro chưa xác định"
          value={loadingRiskContext ? "Đang tải…" : riskContextUnavailable ? "Không khả dụng" : riskCoverage.unknownRiskItemCount.toLocaleString("vi-VN")}
          valueClassName={!loadingRiskContext && !riskContextUnavailable && riskCoverage.unknownRiskItemCount > 0 ? "text-amber-200" : undefined}
        />
      </div>

      {riskContextError ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Không thể tải ngữ cảnh rủi ro: {riskContextError}. Không suy diễn phần phân rã trống thành rủi ro đang hoạt động bằng 0.</span>
        </div>
      ) : null}
    </section>
  )
}

function HoldingMetric({
  label,
  labelNode,
  value,
  warning = false,
  valueClassName,
}: {
  label?: string
  labelNode?: ReactNode
  value: string
  warning?: boolean
  valueClassName?: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{labelNode ?? label}</div>
      <div className={cn("mt-1 text-[11px] font-black text-slate-100", warning && "text-amber-200", valueClassName)}>{value}</div>
    </div>
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
    <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 text-xs font-black text-slate-100", valueClassName)}>{value}</div>
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
  if (value == null) return "text-slate-500"
  if (value > 0) return "text-[var(--color-up)]"
  if (value < 0) return "text-[var(--color-down)]"
  return "text-slate-100"
}
