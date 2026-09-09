"use client"

import type { ConcentrationCheck, ConcentrationStatus } from "@/modules/portfolio/concentration/types"
import type { ProjectedTradeConcentrationResult } from "@/modules/portfolio/concentration/project-trade"

export function ProjectedConcentrationPanel({
  projection,
}: {
  projection: ProjectedTradeConcentrationResult
}) {
  return (
    <section data-projected-concentration className="mt-4 rounded-2xl border border-purple-500/20 bg-purple-500/[0.055] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-purple-300/70">Tập trung sau giao dịch dự kiến</p>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            Đây là lớp cảnh báo xác định sau khi QEO-139 đã tính khối lượng; đa dạng hóa không thay đổi công thức hoặc khối lượng giao dịch.
          </p>
        </div>
        <StatusBadge status={projection.overallStatus} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <ProjectionMetric label="Tỷ trọng mã" check={projection.tickerMarketValue} />
        <ProjectionMetric label="Active Risk theo mã" check={projection.tickerActiveRisk} />
        <ProjectionMetric label="Active Risk ngành" check={projection.sectorActiveRisk} />
        <ProjectionMetric label="Số vị thế" check={projection.openPositions} />
      </div>

      <p className="mt-3 text-[9px] leading-relaxed text-slate-500">
        Mẫu số: Account Equity hiện tại {formatVnd(projection.basis.accountEquityVnd)}. Hệ thống không giả định vốn chủ hoặc mark-to-market tương lai.
      </p>
    </section>
  )
}

function ProjectionMetric({ label, check }: { label: string; check: ConcentrationCheck }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-black uppercase tracking-wide text-slate-500">{label}</span>
        <StatusBadge status={check.status} compact />
      </div>
      <p className="mt-1.5 text-sm font-black text-white">{formatMetric(check)}</p>
      <p className="mt-1 text-[9px] text-slate-600">{thresholdCopy(check)}</p>
    </div>
  )
}

function StatusBadge({ status, compact = false }: { status: ConcentrationStatus; compact?: boolean }) {
  const label = status === "WITHIN_PLAN"
    ? "Trong kế hoạch"
    : status === "WARNING"
      ? "Cảnh báo"
      : status === "BREACH"
        ? "Vượt giới hạn"
        : "Chưa xác định"
  return <span className={`rounded-full border border-white/10 bg-black/20 font-black uppercase tracking-wide text-slate-200 ${compact ? "px-2 py-0.5 text-[8px]" : "px-3 py-1 text-[9px]"}`}>{label}</span>
}

function formatMetric(check: ConcentrationCheck): string {
  if (check.metricValue == null || !Number.isFinite(check.metricValue)) return "—"
  return check.metricUnit === "count" ? String(check.metricValue) : `${check.metricValue.toFixed(2)}%`
}

function thresholdCopy(check: ConcentrationCheck): string {
  if (check.breachThreshold != null) return `Giới hạn: ${check.breachThreshold}${check.metricUnit === "count" ? "" : "%"}`
  if (check.warningThreshold != null) return `Cảnh báo: ${check.warningThreshold}%`
  return check.reason === "unknown_sector_classification" ? "Chưa có phân ngành cấu trúc" : "Không có giới hạn áp dụng"
}

function formatVnd(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${Math.round(value).toLocaleString("vi-VN")} VNĐ`
}
