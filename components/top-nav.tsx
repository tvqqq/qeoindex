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
    <header className="flex h-14 items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex min-w-0 items-center gap-5 xl:gap-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label={BRAND.name}>
          <img src="/brand/stockos-mark.svg" alt="" className="h-9 w-9 shrink-0" />
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold tracking-[-0.02em] text-foreground">
              Qeo<span className="text-brand">Index</span>
            </span>
            <span className="text-[10px] text-muted">{BRAND.slogan}</span>
          </div>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex">
          {NAV.map((item) => {
            const on = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "relative whitespace-nowrap px-2.5 py-2 text-sm transition-colors xl:px-3",
                  on ? "font-semibold text-brand" : "text-muted-2 hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
                {on && <span className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-brand" />}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted-2">
        {COMMIT_SHA && (
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2.5 py-1 text-foreground/80">
            <GitCommit className="h-3.5 w-3.5 text-brand" />
            <span className="font-semibold text-foreground">{COMMIT_SHA}</span>
          </div>
        )}
        {COMMIT_DATE && (
          <span className="hidden text-[11px] text-muted sm:inline">
            {COMMIT_DATE}
          </span>
        )}
      </div>
    </header>
  )
}
