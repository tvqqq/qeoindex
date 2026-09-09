import { AlertTriangle, ShieldCheck } from "lucide-react"

import type { PortfolioRiskReadModel } from "@/modules/portfolio/risk-engine/types"
import { cn } from "@/modules/shared/ui/cn"

export function PortfolioRiskStateStrip({ risk }: { risk: PortfolioRiskReadModel }) {
  const riskState = risk.riskState.state
  const concentrationStatus = risk.concentration.summary.overallStatus

  return (
    <div className="border-b border-white/[0.07] bg-gradient-to-r from-violet-500/[0.08] via-transparent to-indigo-500/[0.05] px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300/80">Risk State</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">Rủi ro danh mục hiện tại</h2>
            <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-bold", riskStateClass(riskState))}>
              {riskState === "PAUSE_AND_REVIEW" || riskState === "REDUCE_RISK" || riskState === "UNKNOWN" ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {riskStateLabel(riskState)}
            </span>
          </div>
        </div>

        <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3 xl:max-w-4xl">
          <RiskFact
            label="Rủi ro đang hoạt động"
            value={formatRiskValue(risk.activeRisk.knownActiveRiskVnd, risk.activeRisk.activeRiskPercent)}
            note={risk.activeRisk.unknownRiskItemCount > 0 ? `${risk.activeRisk.unknownRiskItemCount} mục chưa xác định` : "Độ phủ không có mục rủi ro chưa xác định"}
          />
          <RiskFact
            label="Ngân sách rủi ro còn lại"
            value={formatVnd(risk.activeRisk.remainingRiskBudgetVnd)}
            note={risk.activeRisk.coverage === "complete" ? "Theo dữ liệu rủi ro hiện tại" : "Độ phủ rủi ro chưa đầy đủ"}
          />
          <RiskFact
            label="Đa dạng hóa"
            value={concentrationLabel(concentrationStatus)}
            note={`${risk.concentration.summary.openPositionCount.toLocaleString("vi-VN")} vị thế đang mở`}
            status={concentrationStatus}
          />
        </div>
      </div>
    </div>
  )
}

function RiskFact({
  label,
  value,
  note,
  status,
}: {
  label: string
  value: string
  note: string
  status?: PortfolioRiskReadModel["concentration"]["summary"]["overallStatus"]
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-black/10 px-4 py-3">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums text-white", status ? concentrationClass(status) : "")}>{value}</p>
      <p className="mt-1 text-sm leading-5 text-slate-500">{note}</p>
    </div>
  )
}

function formatRiskValue(value: number, percent: number | null): string {
  const formatted = formatVnd(value)
  return percent == null ? formatted : `${formatted} · ${percent.toFixed(2)}%`
}

function formatVnd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${Math.round(value).toLocaleString("vi-VN")} đ`
}

function riskStateLabel(state: PortfolioRiskReadModel["riskState"]["state"]): string {
  if (state === "PAUSE_AND_REVIEW") return "Tạm dừng & rà soát"
  if (state === "REDUCE_RISK") return "Giảm rủi ro"
  if (state === "UNKNOWN") return "Chưa xác định"
  return "Bình thường"
}

function riskStateClass(state: PortfolioRiskReadModel["riskState"]["state"]): string {
  if (state === "PAUSE_AND_REVIEW") return "border-red-500/30 bg-red-500/10 text-red-200"
  if (state === "REDUCE_RISK") return "border-amber-500/30 bg-amber-500/10 text-amber-200"
  if (state === "UNKNOWN") return "border-slate-500/30 bg-slate-500/10 text-slate-300"
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
}

function concentrationLabel(status: PortfolioRiskReadModel["concentration"]["summary"]["overallStatus"]): string {
  if (status === "BREACH") return "Vượt giới hạn"
  if (status === "WARNING") return "Cảnh báo"
  if (status === "UNKNOWN") return "Chưa xác định"
  return "Trong kế hoạch"
}

function concentrationClass(status: PortfolioRiskReadModel["concentration"]["summary"]["overallStatus"]): string {
  if (status === "BREACH") return "text-red-300"
  if (status === "WARNING") return "text-amber-300"
  if (status === "UNKNOWN") return "text-slate-300"
  return "text-emerald-300"
}
