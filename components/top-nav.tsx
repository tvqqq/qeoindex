"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CandlestickChart, Compass, GitCommit, LayoutDashboard, Sparkles } from "lucide-react"

import { BRAND } from "@/lib/brand"

const COMMIT_SHA = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || ""
const COMMIT_DATE = process.env.NEXT_PUBLIC_GIT_COMMIT_DATE || ""

const NAV_ITEMS = [
  { label: "Bảng điện", href: "/", icon: LayoutDashboard, active: (pathname: string) => pathname === "/" },
  { label: "Insights", href: "/insights", icon: Sparkles, active: (pathname: string) => pathname === "/insights" },
  {
    label: "Phân tích chart Wyckoff",
    href: "/insights/wyckoff",
    icon: CandlestickChart,
    active: (pathname: string) => pathname.startsWith("/insights/wyckoff"),
  },
  {
    label: "Nghiên cứu",
    href: "/research",
    icon: Compass,
    active: (pathname: string) => pathname.startsWith("/research"),
  },
] as const

export function TopNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.08] bg-[#070a0e]/96 px-4 shadow-[0_4px_24px_-12px_rgba(0,0,0,0.9)]">
      <div className="flex min-w-0 items-center gap-4 xl:gap-7">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5" aria-label={BRAND.name}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-purple-500/10 to-emerald-500/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_0_12px_rgba(34,201,138,0.12)] transition-colors duration-200 group-hover:border-purple-500/45">
            <img src="/brand/stockos-mark.svg" alt="" className="h-6 w-6 shrink-0" />
          </div>
          <div className="hidden flex-col leading-none sm:flex">
            <span className="font-ticker text-[17px] font-extrabold italic tracking-tight text-white">
              Qeo<span className="bg-gradient-to-r from-emerald-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">Index</span>
            </span>
            <span className="mt-0.5 font-ticker text-[10.5px] font-medium text-slate-400">{BRAND.slogan}</span>
          </div>
        </Link>

        <nav className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-white/[0.09] bg-[#0a0f14] p-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = item.active(pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={[
                  "group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors duration-150",
                  active
                    ? "border-emerald-400/45 bg-emerald-400/12 text-emerald-200"
                    : "border-transparent text-slate-400 hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white",
                ].join(" ")}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? "text-emerald-300" : "text-slate-500 group-hover:text-slate-200"}`} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {COMMIT_SHA ? (
        <div
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1 font-mono text-[10px] text-slate-500 lg:flex"
          title={COMMIT_DATE ? `Commit: ${COMMIT_SHA} • ${COMMIT_DATE}` : `Commit: ${COMMIT_SHA}`}
        >
          <GitCommit className="h-3 w-3 text-emerald-400/70" />
          <span>{COMMIT_SHA}</span>
        </div>
      ) : null}
    </header>
  )
}
