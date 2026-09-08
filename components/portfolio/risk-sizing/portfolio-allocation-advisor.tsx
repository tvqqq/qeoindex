"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
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
    ? "Thủ công"
    : portfolioAccountEquityContext.source === "portfolio_partial"
      ? "Dữ liệu một phần"
      : "Từ danh mục"

  const advisorMessage = loadingRiskContext
    ? "Đang tải Kế hoạch quản trị vốn và bằng chứng rủi ro đang hoạt động cho danh mục hiện tại."
    : riskContextUnavailable
      ? "Không có ngữ cảnh rủi ro. Không diễn giải rủi ro đang hoạt động hoặc ngân sách rủi ro còn lại thành số 0."
      : unknownRiskItemCount > 0
        ? `Có ${unknownRiskItemCount} giao dịch/khoản nắm giữ đang mở chưa đủ bằng chứng rủi ro chuẩn. Rủi ro đang hoạt động đã biết chỉ là phần đã xác định, chưa phải tổng rủi ro danh mục.`
        : effectiveAccountEquityContext.source === "portfolio_partial"
          ? `Vốn tài khoản đang là dữ liệu một phần vì thiếu giá thị trường cho ${effectiveAccountEquityContext.missingPriceTickers.join(", ") || "một số mã"}. Cần rà soát trước khi dùng giới hạn rủi ro như bằng chứng đầy đủ.`
          : riskContext?.maxActiveRiskPercent == null
            ? "Rủi ro đang hoạt động tối đa chưa được cấu hình trong Kế hoạch quản trị vốn; có thể xem sức chứa hiện tại nhưng chưa thể kết luận kế hoạch nằm trong giới hạn."
            : `Rủi ro đang hoạt động đã biết hiện dùng ${formatPercentOf(riskContext.knownActiveRiskVnd, effectiveAccountEquityContext.valueVnd)} vốn tài khoản; ngân sách rủi ro còn lại là ${formatVnd(remainingRiskBudgetVnd)}.`

  return (
    <section
      data-planner-panel="allocation"
      className="overflow-hidden rounded-[28px] border border-purple-500/15 bg-gradient-to-b from-[#11101a] to-[#0a0d13] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.035]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-purple-400/70">Sức chứa danh mục</p>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-purple-200 sm:text-base">
            <ShieldCheck className="h-4 w-4" /> 1. Tư vấn phân bổ vốn
          </h3>
        </div>
        <span className="rounded-full border border-purple-500/25 bg-purple-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-purple-200">
          Toàn danh mục
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-purple-500/20 bg-purple-500/[0.07] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 font-bold text-purple-100">
              <RiskMetricTooltip term="accountEquity" />
              <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-400">{equitySourceLabel}</span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
              Có thể nhập thủ công khi số vốn tài khoản từ công ty chứng khoán đáng tin cậy hơn dữ liệu định giá hiện tại.
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
                ? "cursor-default border-white/5 text-slate-600"
                : "border-purple-500/30 text-purple-200 hover:bg-purple-500/10",
            )}
            disabled={manualAccountEquityVnd == null}
          >
            <RotateCcw className="h-3 w-3" /> Dùng dữ liệu danh mục
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
            className="h-11 border-purple-500/15 bg-black/30 font-ticker text-base font-black text-white"
          />
          <span className="font-bold text-slate-500">VNĐ</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <MetricTile label="Vốn ban đầu" value={formatVnd(allocationSnapshot.initialCapitalVnd)} />
        <MetricTile label="Lãi/lỗ đã thực hiện" value={formatSignedVnd(allocationSnapshot.totalRealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalRealizedPnlVnd)} />
        <MetricTile label="Lãi/lỗ chưa thực hiện" value={formatSignedVnd(allocationSnapshot.totalUnrealizedPnlVnd)} valueClassName={pnlClass(allocationSnapshot.totalUnrealizedPnlVnd)} />
        <MetricTile label="Giá trị thị trường cổ phiếu" value={formatVnd(allocationSnapshot.stockMarketValueVnd)} />
        <MetricTile label="Tiền mặt khả dụng ước tính" value={formatVnd(allocationSnapshot.estimatedAvailableCashVnd)} valueClassName="text-emerald-300" />
        <MetricTile
          labelNode={<RiskMetricTooltip term="riskPerTrade" />}
          value={loadingRiskContext ? "Đang tải…" : riskContextUnavailable ? "Không khả dụng" : riskContext ? `${riskContext.defaultTradeRiskPercent.toFixed(2)}%` : "Không khả dụng"}
        />
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.07] bg-black/20 p-4">
        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Sức chứa rủi ro</p>
        <div className="mt-2 space-y-1">
          <MetricRow
            labelNode={<RiskMetricTooltip term="activeRisk" />}
            value={loadingRiskContext ? "Đang tải…" : riskContextUnavailable ? "Không khả dụng" : formatVnd(riskContext?.knownActiveRiskVnd ?? null)}
          />
          <MetricRow
            labelNode={<RiskMetricTooltip term="maxActiveRisk" />}
            value={loadingRiskContext ? "Đang tải…" : riskContextUnavailable ? "Không khả dụng" : maxActiveRiskVnd == null ? "Chưa cấu hình" : formatVnd(maxActiveRiskVnd)}
          />
          <MetricRow
            labelNode={<RiskMetricTooltip term="remainingRiskBudget" />}
            value={loadingRiskContext ? "Đang tải…" : riskContextUnavailable ? "Không khả dụng" : remainingRiskBudgetVnd == null ? "Chưa cấu hình" : formatVnd(remainingRiskBudgetVnd)}
            valueClassName={remainingRiskBudgetVnd != null && remainingRiskBudgetVnd < 0 ? "text-rose-300" : "text-emerald-200"}
          />
        </div>
      </div>

      {effectiveAccountEquityContext.source === "portfolio_partial" ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Thiếu giá thị trường: {effectiveAccountEquityContext.missingPriceTickers.join(", ") || "mã chưa xác định"}. Vốn tài khoản và giá trị thị trường cổ phiếu chỉ là dữ liệu một phần.</span>
        </div>
      ) : null}

      {riskContextError ? (
        <div className="mt-4 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
          Không thể tải ngữ cảnh rủi ro: {riskContextError}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-purple-500/15 bg-purple-500/[0.05] p-4 text-[11px] leading-relaxed text-slate-300">
        <p className="font-black uppercase tracking-wide text-purple-200">Tư vấn phân bổ vốn</p>
        <p className="mt-1.5">{advisorMessage}</p>
      </div>
    </section>
  )
}

function MetricTile({
  label,
  labelNode,
  value,
  valueClassName,
}: {
  label?: string
  labelNode?: ReactNode
  value: string
  valueClassName?: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-3">
      <div className="text-[9px] font-bold uppercase tracking-wide text-slate-500">{labelNode ?? label}</div>
      <div className={cn("mt-1 text-xs font-black text-slate-100", valueClassName)}>{value}</div>
    </div>
  )
}

function MetricRow({
  labelNode,
  value,
  valueClassName,
}: {
  labelNode: ReactNode
  value: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-2 last:border-b-0">
      <span className="text-[11px] text-slate-400">{labelNode}</span>
      <span className={cn("text-right text-[11px] font-black text-slate-100", valueClassName)}>{value}</span>
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
  return `${((value / total) * 100).toFixed(2)}% vốn tài khoản`
}

function pnlClass(value: number): string {
  if (value > 0) return "text-[var(--color-up)]"
  if (value < 0) return "text-[var(--color-down)]"
  return "text-slate-100"
}
