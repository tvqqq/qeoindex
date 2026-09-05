"use client"

import React, { useMemo, useState } from "react"
import Link from "next/link"
import { Bookmark, Plus, Search, Star, TrendingUp, X } from "lucide-react"

import type { StockWatchlistItem } from "./types"
import { cn } from "@/modules/shared/ui/cn"

interface StockWatchlistSidebarProps {
  currentTicker: string
  items: StockWatchlistItem[]
}

type FilterMode = "all" | "top" | "up"

export function StockWatchlistSidebar({ currentTicker, items }: StockWatchlistSidebarProps) {
  const [query, setQuery] = useState("")
  const [filterMode, setFilterMode] = useState<FilterMode>("all")

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = query.trim().toUpperCase()
      if (q && !item.ticker.includes(q) && !item.companyName.toUpperCase().includes(q)) {
        return false
      }
      if (filterMode === "up") return item.changePct > 0
      return true
    })
  }, [items, query, filterMode])

  return (
    <aside className="flex h-full w-[15%] min-w-[210px] max-w-[270px] shrink-0 flex-col overflow-hidden bg-[#070b0f] border-l border-[#16202a]">
      {/* Top Header & Search */}
      <div className="shrink-0 space-y-2 border-b border-[#16202a] bg-[#090d13] p-2.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-300">
            <Bookmark className="size-3.5 fill-cyan-400 text-cyan-400" />
            Watchlist
          </span>
          <span className="font-mono text-[10px] text-slate-500">{items.length} mã</span>
        </div>

        {/* Search Box */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm mã CP..."
            className="w-full rounded-md border border-[#1c2734] bg-[#0e141c] py-1.5 pl-7 pr-6 text-xs text-slate-200 placeholder-slate-500 transition-colors focus:border-cyan-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar text-[10px]">
          <button
            type="button"
            onClick={() => setFilterMode("all")}
            className={cn(
              "rounded px-2 py-0.5 font-bold transition-colors",
              filterMode === "all"
                ? "border border-cyan-800/40 bg-cyan-950 text-cyan-300"
                : "text-slate-400 hover:text-white"
            )}
          >
            Tất cả
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("top")}
            className={cn(
              "rounded px-2 py-0.5 font-bold transition-colors",
              filterMode === "top"
                ? "border border-cyan-800/40 bg-cyan-950 text-cyan-300"
                : "text-slate-400 hover:text-white"
            )}
          >
            Top 50
          </button>
          <button
            type="button"
            onClick={() => setFilterMode("up")}
            className={cn(
              "rounded px-2 py-0.5 font-bold transition-colors",
              filterMode === "up"
                ? "border border-cyan-800/40 bg-cyan-950 text-cyan-300"
                : "text-slate-400 hover:text-white"
            )}
          >
            Tăng
          </button>
        </div>
      </div>

      {/* Stock Tickers List */}
      <div className="flex-1 divide-y divide-[#131b24] overflow-y-auto">
        {filteredItems.map((item) => {
          const isActive = item.ticker === currentTicker.toUpperCase()
          const isUp = item.changePct > 0
          const isDown = item.changePct < 0
          const colorCls = isUp ? "text-emerald-400" : isDown ? "text-rose-400" : "text-amber-400"

          return (
            <Link
              key={item.ticker}
              href={`/research/${item.ticker.toLowerCase()}`}
              prefetch={false}
              className={cn(
                "block p-2.5 transition-colors hover:bg-white/[0.04]",
                isActive
                  ? "border-l-2 border-cyan-400 bg-[#0f1722]"
                  : "border-l-2 border-transparent"
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("font-mono text-xs font-black", isActive ? "text-cyan-300" : "text-white")}>
                  {item.ticker}
                </span>
                <span className={cn("font-mono text-xs font-bold", colorCls)}>
                  {item.price ? item.price.toLocaleString("vi-VN") : "—"}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between font-mono text-[10px]">
                <span className="max-w-[85px] truncate text-slate-400 font-sans" title={item.companyName}>
                  {item.companyName}
                </span>
                <span className={cn("font-semibold", colorCls)}>
                  {item.changePct > 0 ? `+${item.changePct.toFixed(2)}%` : `${item.changePct.toFixed(2)}%`}
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Footer / Add Watchlist Button */}
      <div className="border-t border-[#16202a] bg-[#090d13] p-2 text-center">
        <Link
          href="/portfolio"
          prefetch={false}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-[#243447] py-1.5 text-[11px] font-semibold text-slate-400 transition-colors hover:border-cyan-500/40 hover:text-cyan-300"
        >
          <Plus className="size-3" />
          <span>Quản lý Watchlist</span>
        </Link>
      </div>
    </aside>
  )
}
