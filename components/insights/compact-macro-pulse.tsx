import type {
  CompactMacroPulseData,
  MacroFreshness,
  MacroPulseMetric,
} from "@/modules/research/market-insight/macro-pulse"
import { cn } from "@/modules/shared/ui/cn"

function formatNumber(value: number | null | undefined, decimals = 2) {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("vi-VN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatSignedPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`
}

function formatAsOf(value: string | null | undefined) {
  if (!value) return "Không có timestamp"
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "Timestamp không hợp lệ"
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function freshnessLabel(freshness: MacroFreshness) {
  if (freshness === "fresh") return "Fresh"
  if (freshness === "delayed") return "Delayed"
  if (freshness === "stale") return "Stale"
  if (freshness === "unavailable") return "Unavailable"
  return "Unknown"
}

function freshnessClass(freshness: MacroFreshness) {
  if (freshness === "fresh") return "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"
  if (freshness === "delayed") return "border-amber-300/20 bg-amber-300/[0.08] text-amber-300"
  if (freshness === "stale") return "border-orange-300/20 bg-orange-300/[0.08] text-orange-300"
  return "border-white/[0.08] bg-white/[0.03] text-slate-400"
}

function MacroTile({
  label,
  metric,
  primary,
  secondary,
}: {
  label: string
  metric: MacroPulseMetric
  primary: string
  secondary: string
}) {
  const muted = metric.status !== "ready" || metric.freshness === "stale"
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border border-white/[0.06] bg-[#07131d]/70 px-3 py-2.5",
        muted && "opacity-70",
      )}
      title={`${metric.source} · ${formatAsOf(metric.asOf)}${metric.message ? ` · ${metric.message}` : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-black text-slate-300">{label}</span>
        <span className={cn("rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-bold", freshnessClass(metric.freshness))}>
          {freshnessLabel(metric.freshness)}
        </span>
      </div>
      <strong className="mt-1 block truncate font-mono text-sm font-black text-white">{primary}</strong>
      <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-400">{secondary}</span>
      <span className="mt-1 block truncate text-[9px] text-slate-500">{metric.source} · {formatAsOf(metric.asOf)}</span>
    </div>
  )
}

function unavailablePulse(): CompactMacroPulseData["metrics"] {
  const unavailable = (source: string, unit: string): MacroPulseMetric => ({
    status: "unavailable",
    freshness: "unavailable",
    value: null,
    secondaryValue: null,
    changePct: null,
    change: null,
    asOf: null,
    source,
    unit,
    message: "Chưa có dữ liệu.",
  })
  return {
    usdVnd: unavailable("Vietcombank", "VND/USD"),
    vndOvernight: unavailable("Nguồn chưa xác minh", "%"),
    dxy: unavailable("TradingView", "index"),
    wti: unavailable("TradingView", "USD/barrel"),
  }
}

export function CompactMacroPulse({ pulse }: { pulse?: CompactMacroPulseData | null }) {
  const metrics = pulse?.metrics ?? unavailablePulse()
  const usdPrimary = metrics.usdVnd.value == null
    ? "—"
    : `${formatNumber(metrics.usdVnd.value, 0)} / ${formatNumber(metrics.usdVnd.secondaryValue, 0)}`

  return (
    <div data-compact-macro-pulse className="mt-3 rounded-2xl border border-sky-400/15 bg-sky-400/[0.025] p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.2em] text-sky-300">Compact macro pulse</p>
          <h3 className="mt-0.5 text-sm font-bold text-white sm:text-base">FX · lãi suất · USD · dầu</h3>
          <p className="mt-0.5 text-xs text-slate-400">{pulse?.message ?? "Macro context hiện chưa đầy đủ."}</p>
        </div>
        <span className={cn(
          "rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold",
          pulse?.status === "ready"
            ? "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-300"
            : "border-amber-300/20 bg-amber-300/[0.08] text-amber-300",
        )}>
          {pulse?.status === "ready" ? "Ready" : "Degraded"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
        <MacroTile
          label="USD/VND"
          metric={metrics.usdVnd}
          primary={usdPrimary}
          secondary={metrics.usdVnd.status === "ready" ? "Mua CK / Bán · VND mỗi USD" : metrics.usdVnd.message ?? "Unavailable"}
        />
        <MacroTile
          label="VND O/N"
          metric={metrics.vndOvernight}
          primary={metrics.vndOvernight.value == null ? "—" : `${formatNumber(metrics.vndOvernight.value, 2)}%`}
          secondary={metrics.vndOvernight.message ?? "Nguồn overnight tự động chưa được xác minh"}
        />
        <MacroTile
          label="DXY"
          metric={metrics.dxy}
          primary={formatNumber(metrics.dxy.value, 2)}
          secondary={metrics.dxy.status === "ready" ? `Today ${formatSignedPercent(metrics.dxy.changePct)}` : metrics.dxy.message ?? "Unavailable"}
        />
        <MacroTile
          label="WTI"
          metric={metrics.wti}
          primary={metrics.wti.value == null ? "—" : `$${formatNumber(metrics.wti.value, 2)}`}
          secondary={metrics.wti.status === "ready" ? `Today ${formatSignedPercent(metrics.wti.changePct)}` : metrics.wti.message ?? "Unavailable"}
        />
      </div>

      <p className="mt-2.5 text-[10px] leading-4 text-slate-500">
        TradingView timestamp là thời điểm QeoIndex đọc snapshot; ngoài giờ giao dịch có thể phản ánh last close. Macro chỉ cung cấp context và không ghi đè tín hiệu price/volume nội địa.
      </p>
    </div>
  )
}
