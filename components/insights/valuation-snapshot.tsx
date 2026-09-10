import type { ValuationSnapshotResult } from "@/modules/research/market-insight/valuation-snapshot"

function formatValue(value: number | null, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

function interpretationLabel(snapshot: ValuationSnapshotResult) {
  if (snapshot.interpretation === "below_average") return "Dưới trung bình"
  if (snapshot.interpretation === "above_average") return "Trên trung bình"
  if (snapshot.interpretation === "around_average") return "Quanh trung bình"
  return "Chưa đủ dữ liệu"
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.07] bg-black/15 px-2.5 py-2">
      <p className="text-[10px] font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm font-black text-slate-100">{value}</p>
    </div>
  )
}

export function ValuationSnapshot({ snapshot }: { snapshot: ValuationSnapshotResult }) {
  const sigma = snapshot.zScore == null ? "—" : `${snapshot.zScore > 0 ? "+" : ""}${formatValue(snapshot.zScore)}σ`
  const percentile = snapshot.percentile == null ? "—" : `${formatValue(snapshot.percentile, 1)}%`

  return (
    <div data-valuation-snapshot className="mb-3 rounded-xl border border-white/[0.07] bg-[#07131d]/55 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Hiện tại" value={formatValue(snapshot.current)} />
        <Stat label="Trung vị" value={formatValue(snapshot.median)} />
        <Stat label="Trung bình" value={formatValue(snapshot.mean)} />
        <Stat label="Percentile" value={percentile} />
        <Stat label="σ so với TB" value={sigma} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] leading-4 text-slate-500">
        <span>{snapshot.sampleSize} quan sát hợp lệ · {interpretationLabel(snapshot)}</span>
        {(snapshot.percentile == null || snapshot.zScore == null) && (
          <span>Chưa đủ dữ liệu thống kê (cần ≥20 quan sát và variance hợp lệ cho σ).</span>
        )}
      </div>
    </div>
  )
}
