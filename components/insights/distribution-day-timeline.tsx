import type { DistributionDayTimelineContext, DistributionTimelineSession } from "@/modules/research/market-insight/distribution-day-timeline"

function formatSignedPct(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value)}%`
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00+07:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" }).format(parsed)
}

function recencyLabel(value: number | null) {
  if (value == null) return "Chưa có mark xác minh"
  if (value === 0) return "Ngay phiên mới nhất"
  return `${value} phiên trước`
}

function sessionClass(item: DistributionTimelineSession) {
  if (item.isDistributionDay) return "border-rose-300/40 bg-rose-400/80 shadow-[0_0_10px_rgba(251,113,133,0.24)]"
  if (item.isExpiry) return "border-amber-300/40 bg-amber-300/25"
  if (item.distributionCount == null) return "border-slate-600/40 bg-slate-700/30"
  return "border-cyan-300/10 bg-cyan-300/10"
}

export function DistributionDayTimeline({ context }: { context: DistributionDayTimelineContext }) {
  return (
    <div data-distribution-day-timeline className="mt-4 rounded-xl border border-white/[0.07] bg-[#07131d]/70 p-3.5 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-rose-300">Distribution timeline</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-400">25 phiên gần nhất · chỉ mark khi canonical count tăng đúng +1 giữa hai phiên liền kề có dữ liệu.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
          <span className="rounded-full border border-white/[0.08] bg-black/15 px-2.5 py-1 text-slate-300">
            Canonical count: {context.currentDistributionCount ?? "—"}
          </span>
          <span className="rounded-full border border-rose-300/20 bg-rose-300/[0.07] px-2.5 py-1 text-rose-200">
            10 phiên: {context.verifiedMarks10} mark xác minh
          </span>
          <span className="rounded-full border border-white/[0.08] bg-black/15 px-2.5 py-1 text-slate-300">
            Gần nhất: {recencyLabel(context.latestMarkSessionsAgo)}
          </span>
        </div>
      </div>

      {context.sessions.length ? (
        <div className="mt-4">
          <div className="grid grid-cols-[repeat(25,minmax(0,1fr))] items-end gap-1" aria-label="Distribution Day timeline 25 phiên">
            {context.sessions.map((item) => (
              <div
                key={item.sessionDate}
                className="group relative flex min-w-0 items-end"
                tabIndex={0}
                role="img"
                aria-label={`${item.sessionDate}; VNINDEX ${formatSignedPct(item.vnindexChangePct)}; Khối lượng ${formatSignedPct(item.volumeChangePct)}; Canonical count ${item.distributionCount ?? "chưa có"}`}
              >
                <span
                  className={`block h-8 w-full rounded-sm border transition-transform group-hover:-translate-y-0.5 group-focus-within:-translate-y-0.5 ${sessionClass(item)}`}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-48 -translate-x-1/2 rounded-lg border border-white/[0.1] bg-[#020b12]/95 p-2.5 text-left shadow-2xl group-hover:block group-focus-within:block">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-[11px] text-white">{formatDate(item.sessionDate)}</strong>
                    <span className={`text-[10px] font-bold ${item.isDistributionDay ? "text-rose-300" : item.isExpiry ? "text-amber-300" : "text-slate-400"}`}>
                      {item.isDistributionDay ? "Distribution" : item.isExpiry ? "Count giảm" : "Không mark"}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[10px] leading-4">
                    <dt className="text-slate-500">VNINDEX</dt>
                    <dd className="text-right font-mono text-slate-200">{formatSignedPct(item.vnindexChangePct)}</dd>
                    <dt className="text-slate-500">Khối lượng</dt>
                    <dd className="text-right font-mono text-slate-200">{formatSignedPct(item.volumeChangePct)}</dd>
                    <dt className="text-slate-500">Canonical count</dt>
                    <dd className="text-right font-mono text-slate-200">{item.distributionCount ?? "—"}</dd>
                  </dl>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 text-[9px] text-slate-500">
            <span>{formatDate(context.sessions[0]?.sessionDate || "")}</span>
            <span>{formatDate(context.sessions.at(-1)?.sessionDate || "")}</span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Chưa đủ lịch sử phiên để dựng timeline.</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/[0.06] pt-2.5 text-[10px] text-slate-500">
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-rose-400/80" />Distribution mark xác minh</span>
        <span><span className="mr-1 inline-block size-2 rounded-sm bg-amber-300/30" />Count giảm / expiry context</span>
        <span>{context.verifiedMarks25} mark / 25 phiên · {context.expiryCount25} lần count giảm</span>
        {context.unverifiedTransitionCount25 > 0 && <span>{context.unverifiedTransitionCount25} transition thiếu dữ liệu — không mark</span>}
      </div>

      <p className="mt-2 text-[10px] leading-4 text-slate-600">
        Timeline chỉ diễn giải thay đổi của canonical distribution count đã lưu; không tự thay định nghĩa Distribution Day của nguồn.
      </p>
    </div>
  )
}
