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
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.07] bg-[#0a0e12]/80 backdrop-blur-2xl px-4 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.5)]">
      <div className="flex min-w-0 items-center gap-5 xl:gap-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 group" aria-label={BRAND.name}>
          <div className="relative flex items-center justify-center h-9 w-9 rounded-xl bg-white/[0.04] border border-white/[0.08] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] transition-transform group-hover:scale-105">
            <img src="/brand/stockos-mark.svg" alt="" className="h-6 w-6 shrink-0" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-tight text-foreground flex items-center gap-0.5">
              Qeo<span className="text-brand">Index</span>
            </span>
            <span className="text-[10px] text-muted tracking-tight">{BRAND.slogan}</span>
          </div>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex p-1 rounded-full bg-white/[0.03] border border-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
          {NAV.map((item) => {
            const on = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "relative whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full transition-all duration-200 xl:px-3.5",
                  on
                    ? "bg-white/[0.09] text-white font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.18)] border border-white/[0.12]"
                    : "text-muted-2 hover:text-foreground hover:bg-white/[0.04]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted-2">
        {COMMIT_SHA && (
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-foreground/90 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]">
            <GitCommit className="h-3.5 w-3.5 text-brand" />
            <span className="font-semibold text-foreground tracking-tight">{COMMIT_SHA}</span>
          </div>
        )}
        {COMMIT_DATE && (
          <span className="hidden text-[11px] text-muted sm:inline font-sans">
            {COMMIT_DATE}
          </span>
        )}
      </div>
    </header>
  )
}
