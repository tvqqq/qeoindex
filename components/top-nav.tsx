"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  BarChart2,
  BookOpen,
  Compass,
  GitCommit,
  GitCompare,
  LayoutDashboard,
  Radar,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react"
import { BRAND } from "@/lib/brand"

const NAV = [
  { label: "Bảng điện", href: "/", icon: LayoutDashboard },
  { label: "Nghiên cứu", href: "/research", icon: Compass },
  { label: "FA", href: "/research/fa", icon: BarChart2 },
  { label: "Quét Wyckoff", href: "/research/scanner", icon: Radar },
  { label: "Tín hiệu", href: "/research/signals", icon: Zap },
  { label: "Thay đổi luận điểm", href: "/research/changes", icon: GitCompare },
  { label: "Nhật ký phân tích", href: "/research/log", icon: BookOpen },
  { label: "Hậu kiểm", href: "/research/review", icon: ShieldCheck },
]

const RESEARCH_RESERVED = new Set(["fa", "scanner", "signals", "changes", "log", "review"])
const COMMIT_SHA = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || ""
const COMMIT_DATE = process.env.NEXT_PUBLIC_GIT_COMMIT_DATE || ""

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  if (href === "/research") {
    if (pathname === "/research") return true
    const match = pathname.match(/^\/research\/([^/]+)$/)
    return Boolean(match && !RESEARCH_RESERVED.has(match[1]))
  }
  return pathname.startsWith(href)
}

export function TopNav() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.08] bg-[#070a0e]/90 backdrop-blur-2xl px-4 shadow-[0_4px_30px_-4px_rgba(0,0,0,0.7)]">
      <div className="flex min-w-0 items-center gap-4 xl:gap-7">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 group" aria-label={BRAND.name}>
          <div className="relative flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500/15 via-purple-500/15 to-emerald-500/10 border border-emerald-500/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.25),0_0_14px_rgba(34,201,138,0.25)] transition-all duration-200 group-hover:scale-105 group-hover:border-purple-500/50 group-hover:shadow-[0_0_20px_rgba(176,124,255,0.35)]">
            <img src="/brand/stockos-mark.svg" alt="" className="h-6 w-6 shrink-0 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]" />
          </div>
          <div className="flex flex-col leading-none">
            <div className="flex items-center gap-1.5">
              <span className="text-base font-black tracking-tight text-white flex items-center">
                Qeo<span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 drop-shadow-[0_0_8px_rgba(34,201,138,0.6)]">Index</span>
              </span>
              {/* Animated Neon Green Uptrend Badge */}
              <div className="relative flex items-center justify-center h-4 w-4 rounded bg-emerald-500/20 border border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(34,201,138,0.5),inset_0_1px_0_0_rgba(255,255,255,0.3)]">
                <TrendingUp className="h-2.5 w-2.5 drop-shadow-[0_0_4px_rgba(34,201,138,0.9)] animate-pulse" />
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping opacity-75" />
              </div>
            </div>
            <span className="text-[10px] font-medium text-slate-400 tracking-tight mt-0.5">{BRAND.slogan}</span>
          </div>
        </Link>

        {/* Liquid Glass Navigation with Emerald & Purple Neon Glow */}
        <nav className="hidden min-w-0 items-center gap-1 md:flex p-1 rounded-full bg-[#080c10]/90 border border-white/[0.1] shadow-[0_0_24px_-4px_rgba(176,124,255,0.18),0_0_24px_-4px_rgba(34,201,138,0.18),inset_0_1px_0_0_rgba(255,255,255,0.1)] backdrop-blur-2xl">
          {NAV.map((item) => {
            const on = isActive(pathname, item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "group relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 xl:px-3.5",
                  on
                    ? "bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 font-bold border border-emerald-400/50 shadow-[0_0_16px_rgba(176,124,255,0.35),0_0_10px_rgba(34,201,138,0.4),inset_0_1px_0_0_rgba(255,255,255,0.3)]"
                    : "text-slate-300 hover:text-white hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:border-purple-500/30 border border-transparent hover:shadow-[0_0_12px_rgba(176,124,255,0.2)]",
                ].join(" ")}
              >
                <Icon
                  className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                    on
                      ? "text-emerald-300 drop-shadow-[0_0_8px_rgba(34,201,138,0.8)]"
                      : "text-slate-400 group-hover:text-purple-300 group-hover:drop-shadow-[0_0_6px_rgba(176,124,255,0.6)]"
                  }`}
                />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Hover-to-Reveal Commit Timestamp Pill */}
      <div className="relative group/commit flex shrink-0 items-center font-mono text-xs">
        {COMMIT_SHA && (
          <div
            className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 hover:border-purple-500/50 hover:bg-purple-500/15 px-3 py-1 text-slate-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.12),0_0_12px_rgba(34,201,138,0.2)] hover:shadow-[0_0_18px_rgba(176,124,255,0.35)] transition-all duration-300 cursor-default"
            title={COMMIT_DATE ? `Commit: ${COMMIT_SHA} • ${COMMIT_DATE}` : `Commit: ${COMMIT_SHA}`}
          >
            <GitCommit className="h-3.5 w-3.5 text-emerald-400 drop-shadow-[0_0_6px_rgba(34,201,138,0.8)] group-hover/commit:text-purple-400 group-hover/commit:drop-shadow-[0_0_6px_rgba(176,124,255,0.8)] transition-colors" />
            <span className="font-semibold text-slate-200 tracking-tight">{COMMIT_SHA}</span>
            {COMMIT_DATE && (
              <span className="max-w-0 opacity-0 overflow-hidden whitespace-nowrap group-hover/commit:max-w-xs group-hover/commit:opacity-100 transition-all duration-300 ease-out font-sans text-[11px] text-slate-300 pl-0 group-hover/commit:pl-2 border-l-0 group-hover/commit:border-l border-white/20">
                {COMMIT_DATE}
              </span>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
