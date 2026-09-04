import { AdminSettingsTable } from "@/components/admin/admin-settings-table"
import { AdminUniverseTable } from "@/components/admin/admin-universe-table"
import { loadAdminUniverseView } from "@/modules/admin/universe"

export const dynamic = "force-dynamic"

function dateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

export default async function AdminUniversePage() {
  const view = await loadAdminUniverseView()
  const { universe } = view
  const belowMax = universe.selectedCount < universe.maxSize

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-400">Canonical Market Universe</p>
        <h1 className="mt-1 text-2xl font-bold text-white">Top Stocks 200</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">Membership được publish theo tháng từ KFSP và là source-of-truth dùng chung cho Bảng điện, Bubbles, Qeo Composite, Wyckoff và AI Council.</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Current universe" value={`${universe.selectedCount} / ${universe.maxSize}`} detail={belowMax ? "Ít hơn hard maximum do filter" : "Đủ hard maximum"} warn={belowMax} />
        <Metric label="Detail coverage" value={`${view.detailCompleteCount} / ${universe.selectedCount}`} detail="Popup/detail resolvable" warn={view.detailCompleteCount !== universe.selectedCount} />
        <Metric label="Logo coverage" value={`${view.officialLogoCount + view.generatedFallbackLogoCount} / ${universe.selectedCount}`} detail={`${view.officialLogoCount} official · ${view.generatedFallbackLogoCount} generated`} warn={view.officialLogoCount + view.generatedFallbackLogoCount !== universe.selectedCount} />
        <Metric label="Next monthly update" value={dateTime(view.nextUpdateAt)} detail="07:10 ICT · ngày 1 hàng tháng" />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/[0.08] bg-[#090d13] p-4">
          <h2 className="text-sm font-bold text-white">Current published snapshot</h2>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <Item label="Run ID" value={universe.runId} mono />
            <Item label="KFSP source" value={universe.sourceAsOfDate} mono />
            <Item label="Published" value={dateTime(universe.updatedAt)} />
            <Item label="Qualifying candidates" value={String(universe.candidateCount)} />
            <Item label="Vốn hóa >" value={`${universe.filters.minMarketCapBillion} tỷ VND`} />
            <Item label="KLTB 50D >" value={`${universe.filters.minAverageVolume50d.toLocaleString("vi-VN")} cp`} />
          </dl>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#090d13] p-4">
          <h2 className="text-sm font-bold text-white">Filter cho lần update kế tiếp</h2>
          <p className="mt-1 text-xs text-slate-500">Thay đổi tại đây không sửa membership đang publish; cron kế tiếp mới sử dụng giá trị mới.</p>
          <div className="mt-4"><AdminSettingsTable settings={view.filterSettings} /></div>
        </div>
      </section>

      <AdminUniverseTable stocks={universe.stocks} />
    </div>
  )
}

function Metric({ label, value, detail, warn = false }: { label: string; value: string; detail: string; warn?: boolean }) {
  return <div className="rounded-2xl border border-white/[0.08] bg-[#090d13] p-4"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div><div className={`mt-2 text-lg font-bold ${warn ? "text-amber-300" : "text-white"}`}>{value}</div><div className="mt-1 text-xs text-slate-500">{detail}</div></div>
}
function Item({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt><dd className={`mt-1 break-all text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</dd></div>
}
