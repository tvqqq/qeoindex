import type { LeadershipConcentrationContext } from "@/modules/research/market-insight/leadership-concentration"

function formatShare(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)}%`
}

function stateLabel(context: LeadershipConcentrationContext) {
  if (context.state === "broad") return "Lan tỏa"
  if (context.state === "concentrated") return "Tập trung"
  return context.top10SharePct == null ? "Chưa đủ dữ liệu" : "Chưa xác nhận"
}

function stateClass(context: LeadershipConcentrationContext) {
  if (context.state === "broad") return "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
  if (context.state === "concentrated") return "border-amber-300/20 bg-amber-300/[0.08] text-amber-300"
  return "border-slate-400/20 bg-slate-400/[0.07] text-slate-300"
}

export function LeadershipConcentrationView({ context }: { context: LeadershipConcentrationContext }) {
  return (
    <div data-leadership-concentration className="rounded-xl border border-white/[0.07] bg-[#07131d]/70 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">Leadership concentration</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-400">Tỷ trọng thanh khoản Top 5 / Top 10 trên VNINDEX</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${stateClass(context)}`}>
          {stateLabel(context)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
          <span className="block text-[11px] font-medium text-slate-400">Top 5</span>
          <strong className="mt-0.5 block font-mono text-base text-white">{formatShare(context.top5SharePct)}</strong>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-black/10 px-3 py-2.5">
          <span className="block text-[11px] font-medium text-slate-400">Top 10</span>
          <strong className="mt-0.5 block font-mono text-base text-white">{formatShare(context.top10SharePct)}</strong>
        </div>
      </div>

      {context.top10.length ? (
        <p className="mt-2.5 truncate text-[11px] text-slate-400" title={context.top10.map((item) => item.ticker).join(" · ")}>
          {context.top10.map((item) => item.ticker).join(" · ")}
        </p>
      ) : (
        <p className="mt-2.5 text-[11px] text-slate-500">Cần tối thiểu 10 mã HOSE với giá trị giao dịch hợp lệ cùng phiên.</p>
      )}

      <p className="mt-2 border-t border-white/[0.06] pt-2 text-[10px] leading-4 text-slate-500">
        Lan tỏa &lt;35% · Tập trung ≥50% · 35–&lt;50% Chưa xác nhận. Không suy diễn dòng tiền tổ chức.
      </p>
    </div>
  )
}
