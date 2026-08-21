"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart2,
  BookOpen,
  ChevronDown,
  Compass,
  GitCommit,
  GitCompare,
  LayoutDashboard,
  Radar,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react"
import { BRAND } from "@/lib/brand"

const INSIGHTS_ITEMS = [
  {
    label: "Quét Wyckoff",
    href: "/research/scanner",
    icon: Radar,
    badge: "LIVE",
    badgeColor: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
    iconBg: "bg-cyan-500/10 border-cyan-500/25 text-cyan-400",
    description: "Bộ lọc pha tích lũy & cấu trúc Wyckoff",
  },
  {
    label: "Tín hiệu giao dịch",
    href: "/research/signals",
    icon: Zap,
    badge: "HOT",
    badgeColor: "bg-amber-500/15 border-amber-500/30 text-amber-400",
    iconBg: "bg-emerald-500/10 border-emerald-500/25 text-emerald-400",
    description: "Cảnh báo điểm mua/bán tự động",
  },
  {
    label: "FA & Định giá",
    href: "/research/fa",
    icon: BarChart2,
    iconBg: "bg-purple-500/10 border-purple-500/25 text-purple-400",
    description: "Phân tích cơ bản và định giá doanh nghiệp",
  },
  {
    label: "Nghiên cứu chuyên sâu",
    href: "/research",
    icon: Compass,
    iconBg: "bg-amber-500/10 border-amber-500/25 text-amber-400",
    description: "Tổng quan và tra cứu cổ phiếu Wyckoff",
  },
  {
    label: "Thay đổi luận điểm",
    href: "/research/changes",
    icon: GitCompare,
    badge: "NEW",
    badgeColor: "bg-cyan-500/15 border-cyan-500/30 text-cyan-400",
    iconBg: "bg-blue-500/10 border-blue-500/25 text-blue-400",
    description: "Theo dõi biến động và cập nhật luận điểm",
  },
  {
    label: "Nhật ký phân tích",
    href: "/research/log",
    icon: BookOpen,
    iconBg: "bg-rose-500/10 border-rose-500/25 text-rose-400",
    description: "Lịch sử đánh giá và ghi chú thị trường",
  },
  {
    label: "Hậu kiểm chiến lược",
    href: "/research/review",
    icon: ShieldCheck,
    iconBg: "bg-teal-500/10 border-teal-500/25 text-teal-400",
    description: "Đo lường hiệu suất và kiểm định tín hiệu",
  },
]

const COMMIT_SHA = process.env.NEXT_PUBLIC_GIT_COMMIT_SHA || ""
const COMMIT_DATE = process.env.NEXT_PUBLIC_GIT_COMMIT_DATE || ""

export function TopNav() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const isBoardActive = pathname === "/"
  const isInsightsActive = pathname.startsWith("/research")

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 180)
  }

  useEffect(() => {
    setIsOpen(false)
  }, [pathname])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false)
    }
    document.addEventListener("pointerdown", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

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
        <nav className="flex min-w-0 items-center gap-1.5 p-1 rounded-full bg-[#080c10]/90 border border-white/[0.1] shadow-[0_0_24px_-4px_rgba(176,124,255,0.18),0_0_24px_-4px_rgba(34,201,138,0.18),inset_0_1px_0_0_rgba(255,255,255,0.1)] backdrop-blur-2xl">
          {/* 1. BẢNG ĐIỆN TAB */}
          <Link
            href="/"
            className={[
              "group relative flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200",
              isBoardActive
                ? "bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 font-bold border border-emerald-400/50 shadow-[0_0_16px_rgba(176,124,255,0.35),0_0_10px_rgba(34,201,138,0.4),inset_0_1px_0_0_rgba(255,255,255,0.3)]"
                : "text-slate-300 hover:text-white hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:border-purple-500/30 border border-transparent hover:shadow-[0_0_12px_rgba(176,124,255,0.2)]",
            ].join(" ")}
          >
            <LayoutDashboard
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                isBoardActive
                  ? "text-emerald-300 drop-shadow-[0_0_8px_rgba(34,201,138,0.8)]"
                  : "text-slate-400 group-hover:text-purple-300 group-hover:drop-shadow-[0_0_6px_rgba(176,124,255,0.6)]"
              }`}
            />
            <span>Bảng điện</span>
          </Link>

          {/* 2. INSIGHTS PARENT DROPDOWN */}
          <div
            ref={menuRef}
            className="relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              className={[
                "group relative flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200 select-none",
                isInsightsActive
                  ? "bg-gradient-to-r from-emerald-500/25 via-purple-500/20 to-emerald-500/25 text-emerald-300 font-bold border border-emerald-400/50 shadow-[0_0_16px_rgba(176,124,255,0.35),0_0_10px_rgba(34,201,138,0.4),inset_0_1px_0_0_rgba(255,255,255,0.3)]"
                  : isOpen
                    ? "bg-white/[0.08] text-white border border-white/20 shadow-[0_0_14px_rgba(255,255,255,0.15)]"
                    : "text-slate-300 hover:text-white hover:bg-gradient-to-r hover:from-emerald-500/10 hover:via-purple-500/10 hover:to-transparent hover:border-purple-500/30 border border-transparent hover:shadow-[0_0_12px_rgba(176,124,255,0.2)]",
              ].join(" ")}
              aria-expanded={isOpen}
              aria-haspopup="true"
            >
              <Sparkles
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                  isInsightsActive
                    ? "text-emerald-300 drop-shadow-[0_0_8px_rgba(34,201,138,0.8)]"
                    : "text-amber-400 group-hover:text-amber-300 group-hover:drop-shadow-[0_0_6px_rgba(245,158,11,0.6)]"
                }`}
              />
              <span>Insights</span>
              <ChevronDown
                className={`h-3 w-3 text-slate-400 transition-transform duration-200 ${
                  isOpen ? "rotate-180 text-white" : "group-hover:text-slate-200"
                }`}
              />
            </button>

            {/* Dropdown Menu Panel (Image 1 Style) */}
            {isOpen && (
              <div className="absolute left-0 top-full pt-2 z-50 animate-in fade-in zoom-in-95 duration-150 origin-top-left">
                <div className="w-[360px] sm:w-[390px] rounded-2xl border border-white/[0.12] bg-[#0c1015]/96 p-2 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_30px_rgba(34,201,138,0.12)] backdrop-blur-2xl select-none">
                  {/* Header Title + Subtitle */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08] mb-1.5">
                    <div className="flex flex-col">
                      <span className="font-bold text-sm text-foreground tracking-tight flex items-center gap-1.5">
                        Insights
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      </span>
                      <span className="text-[11px] text-muted-2 font-normal mt-0.5">
                        Phân tích thị trường chuyên sâu
                      </span>
                    </div>
                    <span className="rounded-md bg-amber-500/15 border border-amber-500/35 px-1.5 py-0.5 text-[9.5px] font-black text-amber-400 uppercase tracking-wider shadow-[0_0_8px_rgba(245,158,11,0.2)]">
                      ULTRA
                    </span>
                  </div>

                  {/* Sub-items List */}
                  <div className="space-y-1">
                    {INSIGHTS_ITEMS.map((item) => {
                      const on = pathname === item.href || (item.href === "/research" && pathname.startsWith("/research") && !INSIGHTS_ITEMS.some((i) => i.href !== "/research" && pathname === i.href))
                      const Icon = item.icon
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setIsOpen(false)}
                          className={`group flex items-center gap-3 rounded-xl p-2.5 transition-all duration-150 ${
                            on
                              ? "bg-gradient-to-r from-emerald-500/15 via-purple-500/10 to-transparent border border-emerald-500/30"
                              : "hover:bg-white/[0.05] border border-transparent hover:border-white/[0.08]"
                          }`}
                        >
                          <div
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-transform duration-200 group-hover:scale-105 shadow-sm ${item.iconBg}`}
                          >
                            <Icon className="h-4 w-4 drop-shadow-sm" />
                          </div>

                          <div className="flex flex-1 flex-col min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-xs font-bold transition-colors ${
                                  on ? "text-emerald-300" : "text-foreground group-hover:text-emerald-300"
                                }`}
                              >
                                {item.label}
                              </span>
                              {item.badge && (
                                <span
                                  className={`rounded-full border px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider ${item.badgeColor}`}
                                >
                                  {item.badge}
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-muted-2 group-hover:text-slate-300 transition-colors leading-snug line-clamp-1 mt-0.5 font-normal">
                              {item.description}
                            </span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
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
