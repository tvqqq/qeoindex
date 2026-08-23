"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { CandlestickChart, ChevronDown, Compass, GitCommit, LayoutDashboard, Sparkles } from "lucide-react"

import { BRAND } from "@/lib/brand"

const COMMIT_SHA = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || ""
const COMMIT_DATE = process.env.NEXT_PUBLIC_GIT_COMMIT_DATE || ""

const INSIGHTS_ITEMS = [
  {
    label: "Tổng quan Insights",
    href: "/insights",
    icon: Sparkles,
    badge: "SIGNED IN",
    badgeColor: "border-cyan-500/30 bg-cyan-500/15 text-cyan-300",
    iconBg: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
    description: "VNIndex, rating score và research pulse",
  },
  {
    label: "Phân tích chart Wyckoff",
    href: "/insights/wyckoff",
    icon: CandlestickChart,
    badge: "NEW",
    badgeColor: "border-purple-500/30 bg-purple-500/15 text-purple-300",
    iconBg: "border-purple-500/25 bg-purple-500/10 text-purple-300",
    description: "Chart 1H–1M, phase và kịch bản tiếp theo",
  },
  {
    label: "Nghiên cứu",
    href: "/research",
    icon: Compass,
    badge: "HUB",
    badgeColor: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    iconBg: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    description: "Scanner, tín hiệu, FA, luận điểm, nhật ký & hậu kiểm",
  },
] as const

function insightItemActive(pathname: string, href: string) {
  if (href === "/insights") return pathname === "/insights"
  return pathname.startsWith(href)
}

export function TopNav() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isBoardActive = pathname === "/"
  const isInsightsActive = pathname.startsWith("/insights") || pathname.startsWith("/research")

  function openMenu() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setIsOpen(true)
  }

  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 160)
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    }
  }, [])

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.08] bg-[#070a0e]/96 px-4 shadow-[0_4px_30px_-4px_rgba(0,0,0,0.7)]">
      <div className="flex min-w-0 items-center gap-4 xl:gap-7">
        <Link href="/" prefetch={false} className="group flex shrink-0 items-center gap-2.5" aria-label={BRAND.name}>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-purple-500/15 to-emerald-500/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_0_14px_rgba(34,201,138,0.22)] transition-colors duration-200 group-hover:border-purple-500/50">
            <img src="/brand/stockos-mark.svg" alt="" className="h-6 w-6 shrink-0" />
          </div>
          <div className="hidden flex-col leading-none sm:flex">
            <span className="flex items-center font-ticker text-[17px] font-extrabold italic tracking-tight text-white">
              Qeo<span className="bg-gradient-to-r from-emerald-400 via-teal-200 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">Index</span>
            </span>
            <span className="mt-0.5 font-ticker text-[10.5px] font-medium text-slate-400">{BRAND.slogan}</span>
          </div>
        </Link>

        <nav className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/[0.1] bg-[#080c10]/94 p-1 shadow-[0_0_24px_-4px_rgba(176,124,255,0.16),0_0_24px_-4px_rgba(34,201,138,0.16),inset_0_1px_0_0_rgba(255,255,255,0.08)]">
          <Link
            href="/"
            prefetch={false}
            className={[
              "group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-200",
              isBoardActive
                ? "border-emerald-400/50 bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 font-bold text-emerald-300 shadow-[0_0_16px_rgba(176,124,255,0.28),0_0_10px_rgba(34,201,138,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]"
                : "border-transparent text-slate-300 hover:border-purple-500/30 hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:text-white",
            ].join(" ")}
          >
            <LayoutDashboard className={`h-3.5 w-3.5 ${isBoardActive ? "text-emerald-300" : "text-slate-400 group-hover:text-purple-300"}`} />
            <span>Bảng điện</span>
          </Link>

          <div
            ref={menuRef}
            className="relative"
            onMouseEnter={openMenu}
            onMouseLeave={scheduleClose}
          >
            <div
              className={[
                "group flex items-center rounded-full border transition-colors duration-200",
                isInsightsActive
                  ? "border-emerald-400/50 bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 shadow-[0_0_16px_rgba(176,124,255,0.28),0_0_10px_rgba(34,201,138,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]"
                  : isOpen
                    ? "border-white/20 bg-white/[0.08] text-white"
                    : "border-transparent text-slate-300 hover:border-purple-500/30 hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:text-white",
              ].join(" ")}
            >
              <Link
                href="/insights"
                prefetch={false}
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-1.5 whitespace-nowrap py-1.5 pl-3.5 pr-1 text-xs font-medium"
              >
                <Sparkles className={`h-3.5 w-3.5 ${isInsightsActive ? "text-emerald-300" : "text-amber-400 group-hover:text-amber-300"}`} />
                <span className={isInsightsActive ? "font-bold" : ""}>Insights</span>
              </Link>
              <button
                type="button"
                onClick={() => setIsOpen((current) => !current)}
                className="mr-1 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/[0.08] hover:text-white"
                aria-label="Mở menu Insights"
                aria-expanded={isOpen}
                aria-haspopup="menu"
              >
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
              </button>
            </div>

            {isOpen ? (
              <div className="absolute left-0 top-full z-50 pt-2">
                <div className="w-[360px] select-none rounded-2xl border border-white/[0.12] bg-[#0c1015] p-2 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_30px_rgba(34,201,138,0.12)] sm:w-[390px]">
                  <div className="mb-1.5 flex items-center justify-between border-b border-white/[0.08] px-3.5 py-2.5">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground">
                        Insights
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                      <span className="mt-0.5 text-[11px] font-normal text-muted-2">Phân tích thị trường chuyên sâu</span>
                    </div>
                    <span className="rounded-md border border-amber-500/35 bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-black uppercase tracking-wider text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.18)]">
                      ULTRA
                    </span>
                  </div>

                  <div className="space-y-1" role="menu" aria-label="Các trang Insights">
                    {INSIGHTS_ITEMS.map((item) => {
                      const active = insightItemActive(pathname, item.href)
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          prefetch={false}
                          role="menuitem"
                          onClick={() => setIsOpen(false)}
                          className={[
                            "group flex items-center gap-3 rounded-xl border p-2.5 transition-colors duration-150",
                            active
                              ? "border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-purple-500/10 to-transparent"
                              : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.05]",
                          ].join(" ")}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${item.iconBg}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-xs font-bold transition-colors ${active ? "text-emerald-300" : "text-foreground group-hover:text-emerald-300"}`}>
                                {item.label}
                              </span>
                              <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${item.badgeColor}`}>
                                {item.badge}
                              </span>
                            </div>
                            <span className="mt-0.5 line-clamp-1 text-[11px] font-normal leading-snug text-muted-2 transition-colors group-hover:text-slate-300">
                              {item.description}
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </nav>
      </div>

      {COMMIT_SHA ? (
        <div
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-xs text-slate-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1),0_0_12px_rgba(34,201,138,0.16)] lg:flex"
          title={COMMIT_DATE ? `Commit: ${COMMIT_SHA} • ${COMMIT_DATE}` : `Commit: ${COMMIT_SHA}`}
        >
          <GitCommit className="h-3.5 w-3.5 text-emerald-400" />
          <span className="font-semibold tracking-tight text-slate-200">{COMMIT_SHA}</span>
        </div>
      ) : null}
    </header>
  )
}
