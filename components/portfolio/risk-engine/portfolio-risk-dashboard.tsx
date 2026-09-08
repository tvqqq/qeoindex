"use client"

import { AlertTriangle, Gauge, ShieldCheck } from "lucide-react"

import type { PortfolioRiskReadModel, RiskRuleEvidence } from "@/modules/portfolio/risk-engine/types"
import { RiskTermTooltip } from "./risk-term-tooltip"
import { usePortfolioRiskContext } from "./use-portfolio-risk-context"

export function PortfolioRiskDashboard({ portfolioId }: { portfolioId: string }) {
  const { risk, loading, error } = usePortfolioRiskContext(portfolioId)

  if (!portfolioId) return null
  if (loading && !risk) {
    return <div className="h-44 animate-pulse rounded-3xl border border-white/[0.07] bg-white/[0.02]" />
  }
  if (error && !risk) {
    return (
      <section className="rounded-3xl border border-red-500/20 bg-red-500/[0.07] px-5 py-4 font-ticker text-sm text-red-200">
        <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Không thể tải trạng thái rủi ro</div>
        <p className="mt-1 text-xs text-red-200/80">{error}</p>
      </section>
    )
  }
  if (!risk) return null

  const incomplete = risk.account.completeness !== "complete"
    || risk.activeRisk.coverage !== "complete"
    || risk.drawdown.completeness !== "complete"
  const stateFacts = risk.riskState.state === "UNKNOWN"
    ? risk.riskState.insufficientRules
    : risk.riskState.triggers

  return (
    <section data-portfolio-risk-dashboard className="overflow-hidden rounded-3xl border border-purple-500/15 bg-[#0c1017] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] bg-gradient-to-r from-purple-500/[0.07] via-transparent to-indigo-500/[0.05] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-purple-300" />
            <h2 className="font-ticker text-sm font-extrabold uppercase tracking-wide text-white sm:text-base">Rủi ro danh mục hiện tại</h2>
          </div>
          <p className="mt-1 font-ticker text-[11px] leading-relaxed text-slate-400">
            Một nguồn dữ liệu chuẩn cho vốn chủ tài khoản, mức sụt giảm, stop hiện tại và rủi ro của các Trade đang mở.
          </p>
        </div>
        <RiskStateBadge risk={risk} />
      </div>

      {incomplete && (
        <div className="mx-5 mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 font-ticker text-xs text-amber-200">
          <span className="font-bold">Dữ liệu chưa đầy đủ.</span> Phần rủi ro đã biết vẫn được hiển thị, nhưng không được hiểu là toàn bộ mức rủi ro an toàn của danh mục.
          {risk.activeRisk.unknownRiskItemCount > 0 && <span> Có {risk.activeRisk.unknownRiskItemCount} Trade ở trạng thái <strong>Rủi ro chưa xác định</strong> (Risk Unknown).</span>}
        </div>
      )}

      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <Metric term="accountEquity" value={formatVnd(risk.account.equityVnd)} note={risk.account.completeness === "complete" ? "Đầy đủ" : `Thiếu giá: ${risk.account.missingPriceTickers.join(", ") || "không xác định"}`} />
        <Metric term="drawdown" value={formatPercent(risk.drawdown.drawdownPercent)} note={risk.drawdown.drawdownVnd == null ? "Chưa đủ dữ liệu" : formatVnd(risk.drawdown.drawdownVnd)} />
        <Metric term="activeRisk" value={formatVnd(risk.activeRisk.knownActiveRiskVnd)} note={risk.activeRisk.coverage === "complete" ? "Coverage đầy đủ" : `${risk.activeRisk.unknownRiskItemCount} mục chưa xác định`} />
        <Metric term="activeRiskPercent" value={formatPercent(risk.activeRisk.activeRiskPercent)} note={risk.activeRisk.coverage === "complete" ? "Trên toàn danh mục" : "Chỉ phần rủi ro đã biết"} />
        <Metric term="maxActiveRisk" value={formatVnd(risk.activeRisk.maxActiveRiskVnd)} note="Theo Kế hoạch quản trị vốn" />
        <Metric term="remainingRiskBudget" value={formatVnd(risk.activeRisk.remainingRiskBudgetVnd)} note={risk.activeRisk.remainingRiskBudgetVnd != null && risk.activeRisk.remainingRiskBudgetVnd < 0 ? "Phần đã biết đang vượt giới hạn" : "Không tự suy diễn khi thiếu cap/equity"} />
        <Metric term="initialRisk" value={formatVnd(risk.activeRisk.totalInitialOpenRiskVnd)} note={risk.activeRisk.initialRiskUnknownCount > 0 ? `${risk.activeRisk.initialRiskUnknownCount} Trade thiếu snapshot` : "Tổng snapshot Trade đang mở"} />
        <Metric term="riskState" value={riskStateLabel(risk.riskState.state)} note={`Mức mặc định hiệu lực: ${risk.riskState.effectiveDefaultTradeRiskPercent.toFixed(2)}%`} />
      </div>

      <div className="grid gap-5 border-t border-white/[0.07] p-5 xl:grid-cols-[0.8fr_1.2fr]">
        <div>
          <h3 className="font-ticker text-xs font-black uppercase tracking-[0.14em] text-slate-400">Tài khoản</h3>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-ticker">
            <MiniFact label="Tiền mặt ước tính" value={formatVnd(risk.account.estimatedCashVnd)} />
            <MiniFact label="Giá trị thị trường" value={formatVnd(risk.account.marketValueVnd)} />
            <MiniFact label="Lãi/lỗ đã thực hiện" value={formatVnd(risk.account.realizedPnlVnd)} />
            <MiniFact label="Lãi/lỗ chưa thực hiện" value={formatVnd(risk.account.unrealizedPnlVnd)} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-ticker text-xs font-black uppercase tracking-[0.14em] text-slate-400">Bằng chứng trạng thái</h3>
            <span className="font-ticker text-[10px] font-bold text-slate-500">{stateFacts.length} mục</span>
          </div>
          <div className="mt-3 space-y-2">
            {stateFacts.length === 0 ? (
              <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-ticker text-xs text-slate-400">Không có rule đang kích hoạt hoặc thiếu dữ liệu.</p>
            ) : stateFacts.map((fact) => <RuleFact key={`${fact.ruleId}-${fact.status}`} fact={fact} />)}
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.07] px-5 py-4">
        <h3 className="font-ticker text-xs font-black uppercase tracking-[0.14em] text-slate-400">Rủi ro theo Trade đang mở</h3>
        {risk.activeRisk.rows.length === 0 ? (
          <p className="mt-2 font-ticker text-xs text-slate-500">Chưa có Trade chuẩn hóa đang mở.</p>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {risk.activeRisk.rows.map((row) => (
              <div key={row.tradeId} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 font-ticker">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-black text-white">{row.ticker}</span>
                  <span className={row.riskStatus === "known" ? "text-xs font-bold text-emerald-300" : "text-xs font-bold text-amber-300"}>
                    {row.riskStatus === "known" ? formatVnd(row.activeRiskVnd) : "Rủi ro chưa xác định"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <span>SL: {row.openQty == null ? "—" : row.openQty.toLocaleString("vi-VN")}</span>
                  <span>AVCO: {row.avgCostKvnd == null ? "—" : `${row.avgCostKvnd.toLocaleString("vi-VN")} k₫`}</span>
                  <span><RiskTermTooltip term="currentStop" />: {row.currentStopKvnd == null ? "—" : `${row.currentStopKvnd.toLocaleString("vi-VN")} k₫`}</span>
                  <span>Stop lúc: {formatDateTime(row.latestStopEffectiveAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Metric({ term, value, note }: { term: Parameters<typeof RiskTermTooltip>[0]["term"]; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
      <RiskTermTooltip term={term} />
      <p className="mt-2 font-ticker text-xl font-black tracking-tight text-white">{value}</p>
      <p className="mt-1 font-ticker text-[10px] leading-relaxed text-slate-500">{note}</p>
    </div>
  )
}

function RiskStateBadge({ risk }: { risk: PortfolioRiskReadModel }) {
  const state = risk.riskState.state
  const className = state === "PAUSE_AND_REVIEW"
    ? "border-red-500/30 bg-red-500/10 text-red-200"
    : state === "REDUCE_RISK"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : state === "UNKNOWN"
        ? "border-slate-500/30 bg-slate-500/10 text-slate-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  return (
    <span className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 font-ticker text-[10px] font-black uppercase tracking-wide ${className}`}>
      <ShieldCheck className="h-3.5 w-3.5" /> {riskStateLabel(state)}
    </span>
  )
}

function RuleFact({ fact }: { fact: RiskRuleEvidence }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-ticker text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-200">{ruleLabel(fact.ruleId)}</span>
        <span className={fact.status === "triggered" ? "font-bold text-amber-300" : "font-bold text-slate-400"}>{fact.status === "triggered" ? "Đang kích hoạt" : "Chưa đủ dữ liệu"}</span>
      </div>
      <p className="mt-1 leading-relaxed text-slate-400">{fact.reason}</p>
      <p className="mt-1 text-[10px] text-slate-600">Ngưỡng: {String(fact.configuredThreshold ?? "—")} · Quan sát: {String(fact.observedValue ?? "—")}</p>
    </div>
  )
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2"><span className="block text-[10px] text-slate-500">{label}</span><strong className="mt-1 block text-slate-200">{value}</strong></div>
}

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("vi-VN")} đ`
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value.toFixed(2)}%`
}

function formatDateTime(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
}

function riskStateLabel(state: PortfolioRiskReadModel["riskState"]["state"]): string {
  if (state === "PAUSE_AND_REVIEW") return "Tạm dừng & rà soát"
  if (state === "REDUCE_RISK") return "Giảm rủi ro"
  if (state === "UNKNOWN") return "Chưa xác định"
  return "Bình thường"
}

function ruleLabel(ruleId: string): string {
  if (ruleId === "max_active_risk") return "Giới hạn rủi ro hoạt động"
  if (ruleId === "drawdown_reduce") return "Ngưỡng giảm rủi ro theo sụt giảm"
  if (ruleId === "drawdown_pause") return "Ngưỡng tạm dừng theo sụt giảm"
  if (ruleId === "consecutive_stop_outs") return "Chuỗi stop-out liên tiếp"
  if (ruleId === "rolling_trade_loss") return "Lỗ cộng dồn theo số Trade"
  if (ruleId.startsWith("holiday_")) return "Quy tắc nghỉ giao dịch"
  return ruleId
}
