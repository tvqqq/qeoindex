"use client"

import type { ReactNode } from "react"
import { Activity, AlertTriangle } from "lucide-react"

import {
  describePortfolioAdvisor,
  describeTradeAdvisor,
} from "@/modules/portfolio/risk-sizing/planning"
import type {
  CombinedVerdict,
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
    ? "Đang tải bằng chứng rủi ro danh mục…"
    : describePortfolioAdvisor(simulation)
  const tradeAdvisorMessage = describeTradeAdvisor(plannedTrades)
  const verdict = loadingRiskContext ? null : simulation.verdict

  return (
    <section
      data-planner-panel="simulation"
      className="overflow-hidden rounded-[28px] border border-emerald-500/15 bg-gradient-to-b from-[#0d1715] to-[#0a0d13] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.24)] ring-1 ring-white/[0.035]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-400/70">Dự phóng danh mục</p>
          <h3 className="mt-1 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-emerald-200 sm:text-base">
            <Activity className="h-4 w-4" /> 4. Mô phỏng danh mục tổng hợp
          </h3>
        </div>
        <span className="rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-200">
          Trước → Sau
        </span>
      </div>

      {riskContextError ? (
        <div className="mt-4 flex gap-2 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-3 text-[11px] leading-relaxed text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Không thể tải ngữ cảnh rủi ro: {riskContextError}</span>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <StateColumn title="Trước" eyebrow="Danh mục hiện tại" tone="neutral">
          <Metric label="Vốn tài khoản" value={formatVnd(accountEquityVnd)} />
          <Metric label="Tiền mặt khả dụng ước tính" value={formatVnd(estimatedAvailableCashVnd)} />
          <Metric label="Giá trị thị trường cổ phiếu" value={formatVnd(stockMarketValueVnd)} />
          <Metric
            label="Rủi ro đang hoạt động đã biết"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: knownActiveRiskVnd })}
          />
          <Metric
            label="Ngân sách rủi ro còn lại"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: currentRemainingRiskBudgetVnd, notConfiguredWhenNull: true })}
          />
        </StateColumn>

        <StateColumn title="Dự kiến" eyebrow="Thay đổi từ giỏ kế hoạch" tone="planned">
          <Metric label="Số giao dịch dự kiến" value={plannedTrades.length.toLocaleString("vi-VN")} />
          <Metric label="Giá trị vị thế" value={formatVnd(simulation.plannedPositionValueVnd)} />
          <Metric label="Rủi ro tăng thêm" value={formatVnd(simulation.plannedRiskAddedVnd)} />
        </StateColumn>

        <StateColumn title="Sau" eyebrow="Trạng thái dự phóng" tone="after">
          <Metric label="Tiền mặt ước tính sau kế hoạch" value={formatVnd(simulation.projectedEstimatedCashVnd)} />
          <Metric
            label="Rủi ro đang hoạt động dự kiến"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: simulation.projectedKnownActiveRiskVnd })}
          />
          <Metric
            label="Tỷ lệ rủi ro dự kiến"
            value={loadingRiskContext
              ? "Đang tải…"
              : !riskContextAvailable
                ? "Không khả dụng"
                : formatPercent(simulation.projectedRiskPercent)}
          />
          <Metric
            label="Ngân sách rủi ro còn lại"
            value={riskValue({ loadingRiskContext, riskContextAvailable, valueVnd: simulation.remainingRiskBudgetVnd, notConfiguredWhenNull: true })}
          />
          <Metric label="Thiếu hụt nguồn tiền" value={formatVnd(simulation.fundingGapVnd)} warning={simulation.fundingGapVnd > 0} />
        </StateColumn>
      </div>

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <AdvisorMessage
          title="Tư vấn phân bổ vốn"
          message={portfolioAdvisorMessage}
          warning={!loadingRiskContext && simulation.verdict !== "WITHIN PLAN"}
        />
        <AdvisorMessage title="Tư vấn khối lượng giao dịch" message={tradeAdvisorMessage} />
      </div>

      <div className={cn(
        "mt-3 rounded-2xl border p-4",
        verdict === "WITHIN PLAN" && "border-emerald-500/20 bg-emerald-500/[0.07]",
        verdict === "EXCEEDS PLAN" && "border-rose-500/25 bg-rose-500/[0.07]",
        (verdict === "RISK UNKNOWN" || verdict === "REVIEW REQUIRED") && "border-amber-500/25 bg-amber-500/[0.07]",
        (verdict === "UNAVAILABLE" || verdict == null) && "border-white/[0.08] bg-black/25",
      )}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">Kết luận tổng hợp</p>
            <p className={cn(
              "mt-1 text-xl font-black tracking-tight",
              verdict === "WITHIN PLAN" && "text-emerald-300",
              verdict === "EXCEEDS PLAN" && "text-rose-300",
              (verdict === "RISK UNKNOWN" || verdict === "REVIEW REQUIRED") && "text-amber-300",
              (verdict === "UNAVAILABLE" || verdict == null) && "text-slate-300",
            )}>
              {verdict == null ? "Đang tải…" : verdictLabel(verdict)}
            </p>
          </div>
          {plannedTrades.length > 0 ? (
            <button
              type="button"
              onClick={onClearPlannedTrades}
              className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-400 transition hover:border-white/20 hover:text-white"
            >
              Xóa giỏ kế hoạch
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function StateColumn({
  title,
  eyebrow,
  tone,
  children,
}: {
  title: string
  eyebrow: string
  tone: "neutral" | "planned" | "after"
  children: ReactNode
}) {
  return (
    <div className={cn(
      "rounded-2xl border p-3.5",
      tone === "neutral" && "border-white/[0.07] bg-black/20",
      tone === "planned" && "border-amber-500/15 bg-amber-500/[0.045]",
      tone === "after" && "border-emerald-500/15 bg-emerald-500/[0.045]",
    )}>
      <p className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-600">{eyebrow}</p>
      <h4 className="mt-1 text-[11px] font-black uppercase tracking-[0.16em] text-white">{title}</h4>
      <div className="mt-3 space-y-1">{children}</div>
    </div>
  )
}

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 last:border-b-0">
      <span className="text-[9px] leading-tight text-slate-500">{label}</span>
      <span className={cn("text-right text-[10px] font-black text-slate-200", warning && "text-amber-300")}>{value}</span>
    </div>
  )
}

function AdvisorMessage({ title, message, warning = false }: { title: string; message: string; warning?: boolean }) {
  return (
    <div className={cn(
      "rounded-2xl border p-3.5 text-[10px] leading-relaxed",
      warning
        ? "border-amber-500/20 bg-amber-500/[0.055] text-amber-100"
        : "border-white/[0.07] bg-black/20 text-slate-400",
    )}>
      <p className="font-black uppercase tracking-wide text-white">{title}</p>
      <p className="mt-1.5">{message}</p>
    </div>
  )
}

function verdictLabel(verdict: CombinedVerdict): string {
  switch (verdict) {
    case "WITHIN PLAN": return "Trong giới hạn kế hoạch"
    case "EXCEEDS PLAN": return "Vượt giới hạn kế hoạch"
    case "RISK UNKNOWN": return "Rủi ro chưa xác định"
    case "REVIEW REQUIRED": return "Cần rà soát"
    case "UNAVAILABLE": return "Không khả dụng"
  }
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
  if (loadingRiskContext) return "Đang tải…"
  if (!riskContextAvailable) return "Không khả dụng"
  if (valueVnd == null) return notConfiguredWhenNull ? "Chưa cấu hình" : "—"
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
