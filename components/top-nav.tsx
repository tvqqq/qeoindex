"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Bot, Gift, Hexagon } from "lucide-react"
import { useWSStatus } from "@/lib/use-market"

const NAV = [
  { label: "Bảng điện", href: "/" },
  { label: "Nghiên cứu", href: "/research" },
  { label: "Thay đổi luận điểm", href: "/research/changes" },
  { label: "Nhật ký phân tích", href: "/research/log" },
  { label: "Hậu kiểm", href: "/research/review" },
]

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  if (href === "/research") {
    return pathname === "/research" || /^\/research\/[^/]+$/.test(pathname)
  }
  return pathname.startsWith(href)
}

export function TopNav() {
  const pathname = usePathname()
  const [active, setActive] = useState("Bảng điện")
  const wsStatus = useWSStatus()

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-panel px-4">
      <div className="flex min-w-0 items-center gap-5 xl:gap-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/15">
            <Hexagon className="h-5 w-5 text-brand" strokeWidth={2.2} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-base font-bold text-foreground">
              Stock<span className="text-brand">OS</span>
            </span>
            <span className="text-[10px] text-muted">Bộ công cụ đầu tư</span>
          </div>
        </Link>

        <nav className="hidden min-w-0 items-center gap-1 md:flex">
          {NAV.map((item) => {
            const on = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setActive(item.label)}
                className={[
                  "relative whitespace-nowrap px-2.5 py-2 text-sm transition-colors xl:px-3",
                  on ? "font-semibold text-brand" : "text-muted-2 hover:text-foreground",
                ].join(" ")}
              >
                {item.label}
                {on && (
                  <span className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-brand" />
                )}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-2 xl:gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-panel-2 px-2.5 py-1 text-xs">
          <span className="relative flex h-2 w-2">
            {wsStatus === "connected" && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={[
                "relative inline-flex h-2 w-2 rounded-full",
                wsStatus === "connected"
                  ? "bg-emerald-500"
                  : wsStatus === "connecting"
                  ? "bg-amber-500 animate-pulse"
                  : "bg-rose-500",
              ].join(" ")}
            />
          </span>
          <span className="font-mono text-[11px] font-medium text-foreground">
            {wsStatus === "connected"
              ? "DNSE WS Live"
              : wsStatus === "connecting"
              ? "Đang kết nối..."
              : "WS Offline"}
          </span>
        </div>
        <button
          type="button"
          aria-label="Ưu đãi"
          className="rounded-md p-2 text-muted-2 transition-colors hover:bg-panel-2 hover:text-foreground"
        >
          <Gift className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="hidden items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-2 transition-colors hover:bg-panel-2 hover:text-foreground lg:flex"
        >
          <Bot className="h-4 w-4" />
          <span>Cộng đồng</span>
        </button>
        <div className="flex items-center gap-2 pl-1">
          <span className="hidden text-sm text-foreground xl:inline">quyenjino96</span>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand/20 text-sm font-semibold text-brand">
            Q
          </div>
        </div>
      </div>
    </header>
  )
}
