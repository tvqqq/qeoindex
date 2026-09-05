"use client"

import React, { useMemo, useState } from "react"
import Link from "next/link"
import { Bookmark, Search, Sparkles, X } from "lucide-react"

import type { StockWatchlistItem } from "./types"
import { cn } from "@/modules/shared/ui/cn"

interface StockWatchlistSidebarProps {
  currentTicker: string
  items: StockWatchlistItem[]
  onSelectTicker?: (ticker: string) => void
  isTransitioning?: boolean
}

type FilterMode = "all" | "top" | "up" | "down"

export function StockWatchlistSidebar({
  currentTicker,
  items,
  onSelectTicker,
  isTransitioning = false,
}: StockWatchlistSidebarProps) {
  const [query, setQuery] = useState("")
  const [filterMode, setFilterMode] = useState<FilterMode>("all")

  const filteredItems = useMemo(() => {
    return items.filter((item, index) => {
      const q = query.trim().toUpperCase()
      if (q && !item.ticker.includes(q) && !item.companyName.toUpperCase().includes(q)) {
        return false
      }
      if (filterMode === "top") return index < 20
      if (filterMode === "up") return item.changePct > 0
      if (filterMode === "down") return item.changePct < 0
      return true
    })
  }, [items, query, filterMode])

  function handleItemClick(e: React.MouseEvent<HTMLAnchorElement>, ticker: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    if (onSelectTicker) {
      e.preventDefault()
      onSelectTicker(ticker)
    }
  }

  return (
    <aside className="h-full w-full">
      <div className="flex h-full min-h-[500px] lg:min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#080d13]">
        {/* Top Header & Search */}
        <div className="shrink-0 space-y-3 border-b border-white/[0.06] bg-[#0a0f16] p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-slate-300">
                <Bookmark className="size-3.5 fill-slate-300" />
              </span>
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Watchlist
              </span>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 font-mono text-[10px] text-slate-400">
              {items.length} mã
            </span>
          </div>

          {/* Search Box */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm mã / công ty..."
              className="w-full rounded-xl border border-white/[0.08] bg-[#05080c] py-2 pl-8 pr-7 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-white/30 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="size-3" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {([
              ["all", "Tất cả"],
              ["top", "Top 20"],
              ["up", "Tăng"],
              ["down", "Giảm"],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setFilterMode(val)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-[9px] font-bold transition-colors whitespace-nowrap",
                  filterMode === val
                    ? "border border-white/25 bg-white/15 text-slate-100 font-bold"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Stock Tickers List */}
        <div className="min-h-0 flex-1 divide-y divide-white/[0.04] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              Không tìm thấy mã phù hợp
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isActive = item.ticker === currentTicker.toUpperCase()
              const isUp = item.changePct > 0
              const isDown = item.changePct < 0
              const badgeBg = isUp
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : isDown
                ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                : "bg-white/[0.05] text-slate-300 border-white/10"

              return (
                <Link
                  key={item.ticker}
                  href={`/insights/${item.ticker.toLowerCase()}`}
                  prefetch={false}
                  onClick={(e) => handleItemClick(e, item.ticker)}
                  className={cn(
                    "grid grid-cols-[32px_1fr_auto] items-center gap-2 px-3 py-2.5 transition-colors text-left",
                    isActive
                      ? "border-l-2 border-l-white bg-white/[0.06]"
                      : "border-l-2 border-l-transparent hover:bg-white/[0.03]"
                  )}
                >
                  <span className="font-mono text-[10px] text-slate-600">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0 pr-1">
                    <div className="flex items-center gap-1.5">
                      <b
                        className={cn(
                          "font-ticker text-sm tracking-wide",
                          isActive ? "text-white font-black" : "text-slate-200"
                        )}
                      >
                        {item.ticker}
                      </b>
                      {isActive && isTransitioning && (
                        <span className="size-1.5 rounded-full bg-white animate-ping" />
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span className="font-mono text-slate-400 font-semibold">
                        {item.price ? item.price.toLocaleString("vi-VN") : "—"}
                      </span>
                      <span>·</span>
                      <span className="truncate max-w-[100px]" title={item.companyName}>
                        {item.companyName}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold",
                        badgeBg
                      )}
                    >
                      {isUp ? "+" : ""}
                      {item.changePct.toFixed(2)}%
                    </span>
                  </div>
                </Link>
              )
            })
          )}
        </div>

        {/* Footer / Manage Watchlist Link */}
        <div className="border-t border-white/[0.06] bg-[#0a0f16] p-2.5 text-center">
          <Link
            href="/insights/ai-council"
            prefetch={false}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-[#080d13] py-2 text-[11px] font-bold text-slate-300 transition-colors hover:border-white/20 hover:text-white"
          >
            <Sparkles className="size-3.5 text-slate-400" />
            <span>Xem Bảng xếp hạng AI</span>
          </Link>
        </div>
      </div>
    </aside>
  )
}
