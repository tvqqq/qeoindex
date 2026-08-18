"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { GitCommit } from "lucide-react"
import { BRAND } from "@/lib/brand"

const NAV = [
  { label: "Bảng điện", href: "/" },
  { label: "Nghiên cứu", href: "/research" },
  { label: "FA", href: "/research/fa" },
  { label: "Quét Wyckoff", href: "/research/scanner" },
  { label: "Tín hiệu", href: "/research/signals" },
  { label: "Thay đổi luận điểm", href: "/research/changes" },
  { label: "Nhật ký phân tích", href: "/research/log" },
  { label: "Hậu kiểm", href: "/research/review" },
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
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.08] bg-[#080c10]/85 backdrop-blur-2xl px-4 shadow-[0_4px_24px_-4px_rgba(0,0,0,0.6)]">
      <div className="flex min-w-0 items-center gap-5 xl:gap-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 group" aria-label={BRAND.name}>
          <div className="relative flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-br from-white/[0.08] via-emerald-500/10 to-amber-500/10 border border-white/[0.12] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2),0_0_12px_rgba(34,201,138,0.15)] transition-all duration-200 group-hover:scale-105 group-hover:border-emerald-500/40 group-hover:shadow-[0_0_16px_rgba(34,201,138,0.3)]">
            <img src="/brand/stockos-mark.svg" alt="" className="h-6 w-6 shrink-0 drop-shadow-[0_2px_4px_rgba(0,0,0,0.4)]" />
          </div>
          <div className="flex flex-col leading-none">
            <div className="flex items-center gap-1">
              <span className="text-base font-bold tracking-tight text-white flex items-center">
                Qeo<span className="text-[#22c98a]">Index</span>
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(255,173,0,0.9)] animate-pulse" />
            </div>
            <span className="text-[10px] font-medium text-slate-400 tracking-tight mt-0.5">{BRAND.slogan}</span>
          </div>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex p-1 rounded-full bg-[#0b0f14]/80 border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_4px_20px_rgba(0,0,0,0.4)] backdrop-blur-2xl">
          {NAV.map((item) => {
            const on = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "relative whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 xl:px-3.5",
                  on
                    ? "bg-gradient-to-r from-emerald-500/20 via-emerald-500/15 to-amber-500/15 text-emerald-300 font-bold border border-emerald-500/40 shadow-[0_2px_12px_rgba(34,201,138,0.25),inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                    : "text-slate-300 hover:text-white hover:bg-white/[0.05] hover:border-white/[0.08] border border-transparent",
                ].join(" ")}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-slate-300">
        {COMMIT_SHA && (
          <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-slate-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.3)]">
            <GitCommit className="h-3.5 w-3.5 text-[#22c98a]" />
            <span className="font-semibold text-slate-200 tracking-tight">{COMMIT_SHA}</span>
          </div>
        )}
        {COMMIT_DATE && (
          <span className="hidden text-[11px] text-slate-400 sm:inline font-sans font-medium">
            {COMMIT_DATE}
          </span>
        )}
      </div>
    </header>
  )
}
