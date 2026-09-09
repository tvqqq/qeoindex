"use client"

import type {
  ConcentrationCheck,
  ConcentrationStatus,
  PortfolioConcentrationReadModel,
} from "@/modules/portfolio/concentration/types"

export function PortfolioConcentrationPanel({
  concentration,
}: {
  concentration: PortfolioConcentrationReadModel
}) {
  const topMarketValue = topCheck(concentration.tickerMarketValue)
  const topTickerRisk = topCheck(concentration.tickerActiveRisk)
  const topSectorRisk = topCheck(concentration.sectorActiveRisk.filter((check) => check.sector != null))
  const unknownSectors = concentration.unknownClassificationTickers

  return (
    <section data-portfolio-concentration className="border-t border-white/[0.07] px-5 py-4 font-ticker">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-black uppercase tracking-[0.14em] text-slate-300">Tập trung danh mục</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
            Đánh giá xác định từ tài sản hiện tại, Active Risk QEO-141 và giới hạn trong Kế hoạch quản trị vốn. Không áp ngưỡng mặc định khi người dùng chưa cấu hình.
          </p>
        </div>
        <StatusBadge status={concentration.summary.overallStatus} />
      </div>

      {unknownSectors.length > 0 ? (
        <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-200">
          <strong>Chưa đủ dữ liệu phân ngành.</strong> {unknownSectors.join(", ")} chưa có phân ngành từ nguồn dữ liệu cấu trúc; hệ thống không tự đoán ngành.
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <ConcentrationMetric
          label="Tỷ trọng mã lớn nhất"
          value={topMarketValue ? formatPercent(topMarketValue.metricValue) : "—"}
          detail={topMarketValue?.ticker ?? "Chưa có vị thế định giá được"}
          check={topMarketValue}
        />
        <ConcentrationMetric
          label="Rủi ro chủ động lớn nhất"
          value={topTickerRisk ? formatPercent(topTickerRisk.metricValue) : "—"}
          detail={topTickerRisk?.ticker ?? "Chưa có Active Risk theo mã"}
          check={topTickerRisk}
        />
        <ConcentrationMetric
          label="Rủi ro ngành lớn nhất"
          value={topSectorRisk ? formatPercent(topSectorRisk.metricValue) : "—"}
          detail={topSectorRisk?.sector ?? "Chưa đủ dữ liệu phân ngành"}
          check={topSectorRisk}
        />
        <ConcentrationMetric
          label="Số vị thế đang mở"
          value={String(concentration.summary.openPositionCount)}
          detail={thresholdDetail(concentration.openPositions)}
          check={concentration.openPositions}
        />
      </div>

      <p className="mt-3 text-[9px] leading-relaxed text-slate-600">
        Cơ sở: Account Equity hiện tại · Active Risk QEO-141 · phân ngành canonical
        {concentration.evidence.sectorSourceAsOfDate ? ` · ngành ${concentration.evidence.sectorSourceAsOfDate}` : ""}
        {concentration.evidence.moneyManagementPlanVersion != null ? ` · kế hoạch v${concentration.evidence.moneyManagementPlanVersion}` : ""}.
      </p>
    </section>
  )
}

function topCheck(checks: ConcentrationCheck[]): ConcentrationCheck | null {
  return [...checks]
    .filter((check) => check.metricValue != null && Number.isFinite(check.metricValue))
    .sort((left, right) => (right.metricValue ?? -Infinity) - (left.metricValue ?? -Infinity))[0] ?? null
}

function ConcentrationMetric({
  label,
  value,
  detail,
  check,
}: {
  label: string
  value: string
  detail: string
  check: ConcentrationCheck | null
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{label}</span>
        {check ? <StatusBadge status={check.status} compact /> : null}
      </div>
      <p className="mt-2 text-lg font-black tracking-tight text-white">{value}</p>
      <p className="mt-1 text-[10px] text-slate-500">{detail}</p>
      {check?.breachThreshold != null ? (
        <p className="mt-1 text-[9px] text-slate-600">Giới hạn theo kế hoạch: {formatThreshold(check)}</p>
      ) : check?.warningThreshold != null ? (
        <p className="mt-1 text-[9px] text-slate-600">Ngưỡng cảnh báo: {formatThreshold(check, true)}</p>
      ) : (
        <p className="mt-1 text-[9px] text-slate-600">Không có giới hạn áp dụng</p>
      )}
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
  const className = status === "WITHIN_PLAN"
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200"
    : status === "WARNING"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-200"
      : status === "BREACH"
        ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
        : "border-slate-500/25 bg-slate-500/10 text-slate-300"
  return (
    <span className={`inline-flex shrink-0 rounded-full border font-black uppercase tracking-wide ${compact ? "px-2 py-0.5 text-[8px]" : "px-3 py-1.5 text-[9px]"} ${className}`}>
      {label}
    </span>
  )
}

function formatPercent(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`
}

function formatThreshold(check: ConcentrationCheck, warning = false): string {
  const value = warning ? check.warningThreshold : check.breachThreshold
  if (value == null) return "—"
  return check.metricUnit === "count" ? String(value) : `${value}%`
}

function thresholdDetail(check: ConcentrationCheck): string {
  if (check.breachThreshold == null) return "Chưa cấu hình giới hạn"
  return `Giới hạn theo kế hoạch: ${check.breachThreshold}`
}
