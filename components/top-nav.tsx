"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { BrainCircuit, Briefcase, CandlestickChart, ChevronDown, Compass, GitCommit, LayoutDashboard, Sparkles, Terminal } from "lucide-react"

import { BRAND } from "@/lib/brand"

const COMMIT_SHA = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || ""
const COMMIT_DATE = process.env.NEXT_PUBLIC_GIT_COMMIT_DATE || ""

const INSIGHTS_ITEMS = [
  {
    label: "Tổng quan Insights",
    href: "/insights",
    icon: Sparkles,
    iconBg: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]",
    activeRow: "border-emerald-500/30 bg-gradient-to-r from-emerald-500/15 via-emerald-500/5 to-transparent",
    activeText: "text-emerald-300",
    description: "VNIndex, rating score và research pulse",
  },
  {
    label: "Phân tích chart Wyckoff",
    href: "/insights/wyckoff",
    icon: CandlestickChart,
    iconBg: "border-cyan-500/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.2)]",
    activeRow: "border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 via-cyan-500/5 to-transparent",
    activeText: "text-cyan-300",
    description: "Chart 1H–1M, phase và kịch bản tiếp theo",
  },
  {
    label: "AI Council",
    href: "/insights/ai-council",
    icon: BrainCircuit,
    iconBg: "border-violet-500/30 bg-violet-500/15 text-violet-300 shadow-[0_0_12px_rgba(168,85,247,0.2)]",
    activeRow: "border-violet-500/30 bg-gradient-to-r from-violet-500/15 via-violet-500/5 to-transparent",
    activeText: "text-violet-300",
    description: "5 specialist agents, Bull/Bear debate và Risk audit",
  },
  {
    label: "Nghiên cứu",
    href: "/research",
    icon: Compass,
    iconBg: "border-amber-500/30 bg-amber-500/15 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]",
    activeRow: "border-amber-500/30 bg-gradient-to-r from-amber-500/15 via-amber-500/5 to-transparent",
    activeText: "text-amber-300",
    description: "Scanner, tín hiệu, FA, luận điểm, nhật ký & hậu kiểm",
  },
] as const

function insightItemActive(pathname: string, href: string) {
  if (href === "/insights") return pathname === "/insights"
  return pathname.startsWith(href)
}

function getInsightsActiveStyle(pathname: string) {
  if (pathname.startsWith("/insights/wyckoff")) {
    return {
      pill: "border-cyan-400/50 bg-gradient-to-r from-cyan-500/25 via-blue-500/20 to-cyan-500/25 text-cyan-300 shadow-[0_0_16px_rgba(6,182,212,0.28),0_0_10px_rgba(59,130,246,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]",
      icon: "text-cyan-300",
    }
  }
  if (pathname.startsWith("/insights/ai-council")) {
    return {
      pill: "border-violet-400/50 bg-gradient-to-r from-violet-500/25 via-purple-500/20 to-violet-500/25 text-violet-300 shadow-[0_0_16px_rgba(168,85,247,0.28),0_0_10px_rgba(139,92,246,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]",
      icon: "text-violet-300",
    }
  }
  if (pathname.startsWith("/research")) {
    return {
      pill: "border-amber-400/50 bg-gradient-to-r from-amber-500/25 via-orange-500/20 to-amber-500/25 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.28),0_0_10px_rgba(251,146,60,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]",
      icon: "text-amber-300",
    }
  }
  if (pathname.startsWith("/insights")) {
    return {
      pill: "border-emerald-400/50 bg-gradient-to-r from-emerald-500/25 via-teal-500/20 to-emerald-500/25 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.28),0_0_10px_rgba(20,184,166,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]",
      icon: "text-emerald-300",
    }
  }
  return null
}

export function TopNav() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [isRootUser, setIsRootUser] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isBoardActive = pathname === "/"
  const isPortfolioActive = pathname.startsWith("/portfolio")
  const isAdminActive = pathname.startsWith("/admin")
  const insightsActiveStyle = getInsightsActiveStyle(pathname)

  function openMenu() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setIsOpen(true)
  }

  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 160)
  }

  useEffect(() => {
    fetch("/api/me", { cache: "no-store", credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.isRoot) setIsRootUser(true)
      })
      .catch(() => {})
  }, [])

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
            <span className={isBoardActive ? "" : "hidden sm:inline"}>Bảng điện</span>
          </Link>

          <Link
            href="/portfolio"
            prefetch={false}
            className={[
              "group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors duration-200",
              isPortfolioActive
                ? "border-[#816cff]/50 bg-gradient-to-r from-[#7057ff]/25 via-[#35305f]/35 to-[#7057ff]/20 font-bold text-[#b4a6ff] shadow-[0_0_16px_rgba(124,92,255,0.22),inset_0_1px_0_0_rgba(255,255,255,0.16)]"
                : "border-transparent text-slate-300 hover:border-emerald-500/30 hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-teal-500/10 hover:to-transparent hover:text-white",
            ].join(" ")}
          >
            <Briefcase className={`h-3.5 w-3.5 ${isPortfolioActive ? "text-[#a997ff]" : "text-slate-400 group-hover:text-emerald-300"}`} />
            <span className={isPortfolioActive ? "" : "hidden sm:inline"}>Danh mục</span>
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
                insightsActiveStyle
                  ? insightsActiveStyle.pill
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
                <Sparkles className={`h-3.5 w-3.5 ${insightsActiveStyle ? insightsActiveStyle.icon : "text-amber-400 group-hover:text-amber-300"}`} />
                <span className={insightsActiveStyle ? "font-bold" : ""}>Insights</span>
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
              <div className="fixed left-4 right-4 top-14 z-50 pt-2 sm:absolute sm:left-0 sm:right-auto sm:top-full">
                <div className="mx-auto w-full max-w-[360px] select-none rounded-2xl border border-white/[0.12] bg-[#0c1015] p-2 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_30px_rgba(34,201,138,0.12)] sm:mx-0 sm:w-[390px] sm:max-w-none">
                  <div className="mb-1.5 border-b border-white/[0.08] px-3.5 py-2.5">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground">
                        Insights
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                      <span className="mt-0.5 text-[11px] font-normal text-muted-2">Phân tích thị trường chuyên sâu</span>
                    </div>
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
                              ? item.activeRow
                              : "border-transparent hover:border-white/[0.08] hover:bg-white/[0.05]",
                          ].join(" ")}
                        >
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-sm ${item.iconBg}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className={`text-xs font-bold transition-colors ${active ? item.activeText : "text-foreground group-hover:text-white"}`}>
                              {item.label}
                            </span>
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

          {(isRootUser || isAdminActive) ? (
            <Link
              href="/admin"
              prefetch={false}
              className={[
                "group flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-200",
                isAdminActive
                  ? "border-emerald-400/50 bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 font-bold text-emerald-300 shadow-[0_0_16px_rgba(176,124,255,0.28),0_0_10px_rgba(34,201,138,0.32),inset_0_1px_0_0_rgba(255,255,255,0.22)]"
                  : "border-transparent text-slate-300 hover:border-emerald-500/30 hover:bg-gradient-to-r hover:from-emerald-500/10 hover:to-transparent hover:text-white",
              ].join(" ")}
            >
              <Terminal className={`h-3.5 w-3.5 ${isAdminActive ? "text-emerald-300" : "text-emerald-400 group-hover:text-emerald-300"}`} />
              <span>Quản trị</span>
            </Link>
          ) : null}
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
