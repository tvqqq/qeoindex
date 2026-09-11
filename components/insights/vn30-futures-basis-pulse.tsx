import type { FuturesBasisPulse, FuturesBasisState } from "@/modules/research/market-insight/futures-basis-pulse"
import { cn } from "@/modules/shared/ui/cn"

function formatNumber(value: number | null | undefined, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: decimals }).format(value)
}

function formatSigned(value: number | null | undefined, decimals = 1, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${formatNumber(value, decimals)}${suffix}`
}

function stateLabel(state: FuturesBasisState) {
  if (state === "premium") return "Premium"
  if (state === "discount") return "Chiết khấu"
  if (state === "neutral") return "Trung tính"
  return "Chưa xác định"
}

function stateClass(state: FuturesBasisState) {
  if (state === "premium") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"
  if (state === "discount") return "border-rose-300/20 bg-rose-300/[0.08] text-rose-300"
  if (state === "neutral") return "border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-300"
  return "border-white/[0.08] bg-white/[0.03] text-slate-400"
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-[#07131d]/70 px-3 py-2.5">
      <span className="block text-[11px] font-semibold text-slate-400">{label}</span>
      <strong className="mt-0.5 block truncate font-mono text-sm font-black text-white">{value}</strong>
      <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">{detail}</span>
    </div>
  )
}

export function Vn30FuturesBasisPulse({ pulse }: { pulse?: FuturesBasisPulse | null }) {
  const state = pulse?.state ?? "unknown"
  const statusLabel = pulse?.status === "ready" ? "Cùng phiên" : "Degraded"
  const basisValue = pulse?.basis == null
    ? "—"
    : `${formatSigned(pulse.basis, 1, " điểm")} · ${formatSigned(pulse.basisPct, 3, "%")}`

  return (
    <div data-vn30-futures-basis-pulse className="mt-3 rounded-2xl border border-indigo-400/15 bg-indigo-400/[0.035] p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-indigo-300">VN30 Futures · EOD basis</p>
          <h3 className="mt-0.5 text-sm font-bold text-white sm:text-base">VN30F1M so với VN30 spot</h3>
          <p className="mt-0.5 text-xs text-slate-400">{pulse?.message ?? "Chưa có snapshot futures cùng phiên để tính basis."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold", stateClass(state))}>{stateLabel(state)}</span>
          <span className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] font-bold",
            pulse?.status === "ready"
              ? "border-white/[0.08] bg-white/[0.03] text-slate-300"
              : "border-amber-300/20 bg-amber-300/[0.08] text-amber-300",
          )}>{statusLabel}</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Metric
          label="VN30F1M"
          value={formatNumber(pulse?.futuresLast, 1)}
          detail={pulse?.sessionDate ? `EOD ${pulse.sessionDate}` : "Chưa cùng phiên"}
        />
        <Metric
          label="Basis"
          value={basisValue}
          detail={pulse?.spotValue == null ? "VN30 spot: —" : `VN30 spot ${formatNumber(pulse.spotValue, 2)}`}
        />
        <Metric
          label="Δ Basis"
          value={formatSigned(pulse?.basisChange, 1, " điểm")}
          detail={pulse?.basisChangeMessage ?? "Chưa đủ dữ liệu phiên trước"}
        />
        <Metric
          label="OI"
          value="—"
          detail={pulse?.openInterestMessage ?? "Nguồn OI tự động chưa được xác minh"}
        />
      </div>

      <p className="mt-2.5 text-[10px] leading-4 text-slate-500">
        {pulse
          ? `${pulse.futuresSource} · ${pulse.spotSource} · chỉ so sánh EOD cùng phiên; basis/OI không phải tín hiệu vị thế.`
          : "F1M/spot chỉ được so sánh khi cùng phiên; nguồn OI tự động chưa được xác minh."}
      </p>
    </div>
  )
}
