import type { MarketLeaderItem } from "@/modules/research/market-insight/data"
import type { VnindexContributorsContext } from "@/modules/research/market-insight/vnindex-contributors"

function formatRatio(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`
}

function formatImpact(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} đ`
}

export function VnindexContributionBadge({ context }: { context: VnindexContributorsContext<MarketLeaderItem> }) {
  if (context.concentrationState === "unknown") {
    return <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] font-bold text-slate-400">Chưa đủ dữ liệu</span>
  }

  if (context.concentrationState === "high") {
    return <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-2.5 py-1 text-[11px] font-bold text-amber-300">Tập trung cao</span>
  }

  return <span className="rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 text-[11px] font-bold text-slate-300">Không tập trung cao</span>
}

function ContributorList({ title, items }: { title: string; items: MarketLeaderItem[] }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/[0.06] bg-[#07131d]/70 p-3">
      <p className="text-[11px] font-bold text-slate-300">{title}</p>
      <div className="mt-2 space-y-1.5">
        {items.length ? items.slice(0, 5).map((item) => (
          <div key={`${item.category}-${item.ticker}`} className="flex items-center justify-between gap-3 font-mono text-xs">
            <span className="font-black text-white">{item.ticker}</span>
            <span className={item.estimatedIndexPoints != null && item.estimatedIndexPoints >= 0 ? "text-emerald-300" : "text-rose-300"}>
              {formatImpact(item.estimatedIndexPoints)}
            </span>
          </div>
        )) : <span className="text-xs text-slate-500">Chưa có dữ liệu hợp lệ</span>}
      </div>
    </div>
  )
}

export function VnindexContributorsView({ context }: { context: VnindexContributorsContext<MarketLeaderItem> }) {
  const directionLabel = context.direction === "up" ? "Theo chiều tăng VNINDEX" : context.direction === "down" ? "Theo chiều giảm VNINDEX" : "Chưa có net move hợp lệ"

  return (
    <div className="min-w-0 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/[0.06] bg-[#07131d]/70 px-3 py-2.5">
          <span className="block text-[11px] font-semibold text-slate-400">Top 5</span>
          <strong className="mt-0.5 block font-mono text-base font-black text-white">{formatRatio(context.top5ContributionPct)}</strong>
          <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">{directionLabel}</span>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#07131d]/70 px-3 py-2.5">
          <span className="block text-[11px] font-semibold text-slate-400">Top 10</span>
          <strong className="mt-0.5 block font-mono text-base font-black text-white">{formatRatio(context.top10ContributionPct)}</strong>
          <span className="mt-0.5 block text-[10px] font-semibold text-slate-500">so với net index move</span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ContributorList title="Top 5 kéo tăng" items={context.pullers} />
        <ContributorList title="Top 5 kéo giảm" items={context.draggers} />
      </div>
      <p className="text-[10px] leading-4 text-slate-500">
        Tỷ lệ là tổng đóng góp cùng chiều so với biến động ròng VNINDEX; có thể vượt 100% khi lực kéo và lực cản bù trừ nhau.
      </p>
    </div>
  )
}
