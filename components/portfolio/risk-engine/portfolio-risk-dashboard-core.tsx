"use client"

import { AlertTriangle } from "lucide-react"

import { PortfolioConcentrationPanel } from "@/components/portfolio/concentration/portfolio-concentration-panel"
import { PortfolioRiskStateStrip } from "@/components/portfolio/revamp/portfolio-risk-state-strip"
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
    || risk.riskState.insufficientRules.length > 0
  const evidenceCount = risk.riskState.triggers.length + risk.riskState.insufficientRules.length

  return (
    <section data-portfolio-risk-dashboard className="overflow-hidden rounded-3xl border border-purple-500/15 bg-[#0c1017] shadow-sm">
      <PortfolioRiskStateStrip risk={risk} />

      {incomplete && (
        <div className="mx-5 mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 font-ticker text-sm leading-6 text-amber-200 sm:mx-6">
          <span className="font-bold">Dữ liệu chưa đầy đủ.</span> Phần rủi ro đã biết vẫn được hiển thị, nhưng không được hiểu là toàn bộ mức rủi ro an toàn của danh mục.
          {risk.activeRisk.unknownRiskItemCount > 0 && <span> Có {risk.activeRisk.unknownRiskItemCount} giao dịch ở trạng thái <strong>Rủi ro chưa xác định</strong> (Risk Unknown).</span>}
        </div>
      )}

      <details className="group border-t border-white/[0.07]" open={false}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-bold text-violet-200 marker:content-none sm:px-6">
          <span>Mở bảng rủi ro chi tiết</span>
          <span aria-hidden="true" className="text-lg text-slate-500 transition-transform group-open:rotate-45">+</span>
        </summary>

        <div className="border-t border-white/[0.07]">
          <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
            <Metric term="accountEquity" value={formatVnd(risk.account.equityVnd)} note={risk.account.completeness === "complete" ? "Dữ liệu đầy đủ" : `Thiếu giá: ${risk.account.missingPriceTickers.join(", ") || "không xác định"}`} />
            <Metric term="drawdown" value={formatPercent(risk.drawdown.drawdownPercent)} note={risk.drawdown.drawdownVnd == null ? "Chưa đủ dữ liệu" : formatVnd(risk.drawdown.drawdownVnd)} />
            <Metric term="activeRisk" value={formatVnd(risk.activeRisk.knownActiveRiskVnd)} note={risk.activeRisk.coverage === "complete" ? "Độ phủ dữ liệu đầy đủ" : `${risk.activeRisk.unknownRiskItemCount} mục chưa xác định`} />
            <Metric term="activeRiskPercent" value={formatPercent(risk.activeRisk.activeRiskPercent)} note={risk.activeRisk.coverage === "complete" ? "Trên toàn danh mục" : "Chỉ phần rủi ro đã biết"} />
            <Metric term="maxActiveRisk" value={formatVnd(risk.activeRisk.maxActiveRiskVnd)} note="Theo Kế hoạch quản trị vốn" />
            <Metric term="remainingRiskBudget" value={formatVnd(risk.activeRisk.remainingRiskBudgetVnd)} note={risk.activeRisk.remainingRiskBudgetVnd != null && risk.activeRisk.remainingRiskBudgetVnd < 0 ? "Phần đã biết đang vượt giới hạn" : "Không suy diễn khi thiếu giới hạn hoặc vốn chủ"} />
            <Metric term="initialRisk" value={formatVnd(risk.activeRisk.totalInitialOpenRiskVnd)} note={risk.activeRisk.initialRiskUnknownCount > 0 ? `${risk.activeRisk.initialRiskUnknownCount} giao dịch thiếu snapshot` : "Tổng snapshot giao dịch đang mở"} />
            <Metric term="riskState" value={riskStateLabel(risk.riskState.state)} note={`Mức rủi ro mặc định hiệu lực: ${risk.riskState.effectiveDefaultTradeRiskPercent.toFixed(2)}%`} />
          </div>

          <div className="grid gap-5 border-t border-white/[0.07] p-5 sm:p-6 xl:grid-cols-[0.8fr_1.2fr]">
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
                <span className="font-ticker text-[10px] font-bold text-slate-500">{evidenceCount} mục</span>
              </div>
              {evidenceCount === 0 ? (
                <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-ticker text-xs text-slate-400">Không có quy tắc đang kích hoạt hoặc thiếu dữ liệu.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {risk.riskState.triggers.length > 0 && (
                    <EvidenceGroup title="Đang kích hoạt" facts={risk.riskState.triggers} />
                  )}
                  {risk.riskState.insufficientRules.length > 0 && (
                    <EvidenceGroup title="Thiếu bằng chứng" facts={risk.riskState.insufficientRules} />
                  )}
                </div>
              )}
            </div>
          </div>

          <PortfolioConcentrationPanel concentration={risk.concentration} />

          <div className="border-t border-white/[0.07] px-5 py-4 sm:px-6">
            <h3 className="font-ticker text-xs font-black uppercase tracking-[0.14em] text-slate-400">Rủi ro theo giao dịch đang mở</h3>
            {risk.activeRisk.rows.length === 0 ? (
              <p className="mt-2 font-ticker text-xs text-slate-500">Chưa có giao dịch chuẩn hóa đang mở.</p>
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
                      <span>Khối lượng: {row.openQty == null ? "—" : row.openQty.toLocaleString("vi-VN")}</span>
                      <span>AVCO: {row.avgCostKvnd == null ? "—" : `${row.avgCostKvnd.toLocaleString("vi-VN")} k₫`}</span>
                      <span><RiskTermTooltip term="initialRisk" />: {formatVnd(row.initialRiskAmountVnd)}</span>
                      <span><RiskTermTooltip term="currentStop" />: {row.currentStopKvnd == null ? "—" : `${row.currentStopKvnd.toLocaleString("vi-VN")} k₫`}</span>
                      <span className="col-span-2">Dừng lỗ cập nhật: {formatDateTime(row.latestStopEffectiveAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </details>
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

function EvidenceGroup({ title, facts }: { title: string; facts: RiskRuleEvidence[] }) {
  return (
    <div>
      <p className="mb-1.5 font-ticker text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{title}</p>
      <div className="space-y-2">
        {facts.map((fact) => <RuleFact key={`${fact.ruleId}-${fact.status}`} fact={fact} />)}
      </div>
    </div>
  )
}

function RuleFact({ fact }: { fact: RiskRuleEvidence }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-ticker text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-200">{ruleLabel(fact.ruleId)}</span>
        <span className={fact.status === "triggered" ? "font-bold text-amber-300" : "font-bold text-slate-400"}>{fact.status === "triggered" ? "Đang kích hoạt" : "Chưa đủ dữ liệu"}</span>
      </div>
      <p className="mt-1 leading-relaxed text-slate-400">{ruleReasonVi(fact)}</p>
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
  if (ruleId === "active_risk_coverage") return "Độ phủ rủi ro đang hoạt động"
  if (ruleId === "max_active_risk") return "Giới hạn rủi ro hoạt động"
  if (ruleId === "drawdown_reduce") return "Ngưỡng giảm rủi ro theo sụt giảm"
  if (ruleId === "drawdown_pause") return "Ngưỡng tạm dừng theo sụt giảm"
  if (ruleId === "consecutive_stop_outs") return "Chuỗi dừng lỗ liên tiếp"
  if (ruleId === "rolling_trade_loss") return "Lỗ cộng dồn theo số giao dịch"
  if (ruleId.startsWith("holiday_")) return "Quy tắc nghỉ giao dịch"
  return ruleId
}

function ruleReasonVi(fact: RiskRuleEvidence): string {
  const status = fact.status
  if (fact.ruleId === "active_risk_coverage") return "Một hoặc nhiều giao dịch đang mở chưa có đủ bằng chứng về dừng lỗ hoặc rủi ro hiện tại."
  if (fact.ruleId === "max_active_risk") {
    if (status === "triggered") return "Phần rủi ro đang hoạt động đã biết đã vượt giới hạn được cấu hình."
    if (status === "clear") return "Rủi ro đang hoạt động nằm trong giới hạn được cấu hình."
    return "Chưa đủ Vốn chủ tài khoản hoặc độ phủ rủi ro để kết luận giới hạn rủi ro hoạt động."
  }
  if (fact.ruleId === "drawdown_reduce") return status === "triggered" ? "Mức sụt giảm đã chạm ngưỡng giảm rủi ro." : status === "clear" ? "Mức sụt giảm đang dưới ngưỡng giảm rủi ro." : "Chưa đủ dữ liệu mức sụt giảm hoặc ngưỡng cấu hình."
  if (fact.ruleId === "drawdown_pause") return status === "triggered" ? "Mức sụt giảm đã chạm ngưỡng tạm dừng và rà soát." : status === "clear" ? "Mức sụt giảm đang dưới ngưỡng tạm dừng." : "Chưa đủ dữ liệu mức sụt giảm hoặc ngưỡng tạm dừng."
  if (fact.ruleId === "consecutive_stop_outs") return status === "triggered" ? "Số lần dừng lỗ có bằng chứng liên tiếp đã đạt ngưỡng tạm dừng." : status === "clear" ? "Chuỗi dừng lỗ liên tiếp đang dưới ngưỡng." : "Chưa có ngưỡng dừng lỗ liên tiếp hợp lệ."
  if (fact.ruleId === "rolling_trade_loss") return status === "triggered" ? "Các giao dịch gần nhất trong cửa sổ cấu hình đang có tổng lãi/lỗ ròng âm." : status === "clear" ? "Các giao dịch gần nhất trong cửa sổ cấu hình không có tổng lãi/lỗ ròng âm." : "Chưa đủ số giao dịch đóng chuẩn hóa để đánh giá cửa sổ lỗ cộng dồn."
  if (fact.ruleId.startsWith("holiday_")) return status === "triggered" ? "Quy tắc nghỉ giao dịch của kỳ hiện tại đã kích hoạt." : status === "clear" ? "Quy tắc nghỉ giao dịch của kỳ hiện tại chưa kích hoạt." : "Quy tắc nghỉ giao dịch của kỳ hiện tại chưa đủ bằng chứng để kết luận."
  return "Xem bằng chứng và ngưỡng quan sát của quy tắc này."
}
