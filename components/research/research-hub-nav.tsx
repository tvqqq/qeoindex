import Link from "next/link"
import { BarChart2, BookOpen, GitCompare, LayoutDashboard, Radar, ShieldCheck, Zap } from "lucide-react"

export type ResearchHubView = "overview" | "scanner" | "signals" | "fa" | "changes" | "log" | "review"

const HUB_ITEMS: { view: ResearchHubView; label: string; icon: typeof LayoutDashboard }[] = [
  { view: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { view: "scanner", label: "Quét Wyckoff", icon: Radar },
  { view: "signals", label: "Tín hiệu", icon: Zap },
  { view: "fa", label: "FA & Định giá", icon: BarChart2 },
  { view: "changes", label: "Thay đổi luận điểm", icon: GitCompare },
  { view: "log", label: "Nhật ký", icon: BookOpen },
  { view: "review", label: "Hậu kiểm", icon: ShieldCheck },
]

export function ResearchHubNav({ active }: { active: ResearchHubView }) {
  return (
    <section className="border-b border-border bg-[#090d12]">
      <div className="mx-auto max-w-[1800px] px-4 py-4 lg:px-6">
        <div className="mb-3">
          <h1 className="font-ticker text-2xl font-extrabold italic tracking-tight text-white">Trung tâm Nghiên cứu</h1>
          <p className="mt-1 text-sm text-slate-500">Scanner, tín hiệu, FA, luận điểm, nhật ký và hậu kiểm trên cùng một workspace.</p>
        </div>
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Các module nghiên cứu">
          {HUB_ITEMS.map((item) => {
            const Icon = item.icon
            const on = active === item.view
            const href = item.view === "overview" ? "/research" : `/research?view=${item.view}`
            return (
              <Link
                key={item.view}
                href={href}
                prefetch={false}
                className={[
                  "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors",
                  on
                    ? "border-emerald-400/35 bg-emerald-400/10 text-emerald-200"
                    : "border-white/[0.07] bg-white/[0.02] text-slate-400 hover:bg-white/[0.05] hover:text-white",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </section>
  )
}
