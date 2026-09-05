"use client"

import React, { useState } from "react"
import { Bell, Bookmark, Check, ExternalLink, Share2, Star } from "lucide-react"

import type { StockDetailData } from "./types"
import { cn } from "@/modules/shared/ui/cn"

export function StockCompanyHeader({ data }: { data: StockDetailData }) {
  const {
    ticker,
    companyName,
    exchange,
    sector,
    price,
    change,
    changePct,
    refPrice,
    ceilingPrice,
    floorPrice,
    highPrice,
    lowPrice,
    volume,
    marketCapT,
    pe,
    pb,
  } = data

  const [isBookmarked, setIsBookmarked] = useState(false)
  const [copied, setCopied] = useState(false)

  const isUp = change > 0
  const isDown = change < 0
  const isCeiling = price >= ceilingPrice && ceilingPrice > 0
  const isFloor = price <= floorPrice && floorPrice > 0

  const priceColor = isCeiling
    ? "text-purple-400"
    : isFloor
    ? "text-cyan-400"
    : isUp
    ? "text-emerald-400"
    : isDown
    ? "text-rose-400"
    : "text-amber-400"

  function handleShare() {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#131b24] bg-[#090d14] p-4">
      {/* Ticker Symbol with Neon Glow & Company Name */}
      <div className="flex items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-gradient-to-br from-cyan-950/80 to-[#0c141d] shadow-[0_0_20px_rgba(0,240,255,0.25)]">
          <span className="font-mono text-base font-black text-cyan-300">{ticker}</span>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="neon-ticker-glow font-mono text-3xl font-black tracking-tight text-cyan-300">
              {ticker}
            </h1>
            <span className="rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-300">
              {exchange || "HOSE"}
            </span>
            <span className="text-xs font-medium text-slate-400">
              {sector || "Thị trường Việt Nam"}
            </span>
          </div>
          <div className="mt-0.5 max-w-[380px] truncate text-xs text-slate-400" title={companyName}>
            {companyName}
          </div>
        </div>

        {/* Realtime Price & Change */}
        <div className="border-l border-[#192330] pl-5">
          <div className="flex items-baseline gap-2.5">
            <span className={cn("font-mono text-2xl font-black tracking-tight", priceColor)}>
              {price ? price.toLocaleString("vi-VN") : "—"}
            </span>
            <span className={cn("font-mono text-sm font-bold", priceColor)}>
              {change > 0 ? `+${change.toLocaleString()}` : change.toLocaleString()} (
              {changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`})
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 font-mono text-[11px] text-slate-400">
            <span>TC: <b className="text-slate-300">{refPrice ? refPrice.toLocaleString() : "—"}</b></span>
            <span>Trần: <b className="text-purple-400">{ceilingPrice ? ceilingPrice.toLocaleString() : "—"}</b></span>
            <span>Sàn: <b className="text-cyan-400">{floorPrice ? floorPrice.toLocaleString() : "—"}</b></span>
            <span>Cao: <b className="text-emerald-400">{highPrice ? highPrice.toLocaleString() : "—"}</b></span>
            <span>Thấp: <b className="text-rose-400">{lowPrice ? lowPrice.toLocaleString() : "—"}</b></span>
          </div>
        </div>
      </div>

      {/* Key Quick Stats & Actions */}
      <div className="flex items-center gap-5">
        <div className="hidden grid-cols-4 gap-3 text-right lg:grid">
          <div>
            <span className="block font-mono text-[10px] uppercase text-slate-500">Khối lượng</span>
            <span className="font-mono text-xs font-bold text-slate-200">
              {volume ? `${(volume / 1_000_000).toFixed(2)}M` : "—"}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase text-slate-500">Vốn hóa</span>
            <span className="font-mono text-xs font-bold text-slate-200">
              {marketCapT ? `${marketCapT.toLocaleString()} Tỷ` : "—"}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase text-slate-500">P/E</span>
            <span className="font-mono text-xs font-bold text-slate-200">
              {pe ? `${pe.toFixed(1)}x` : "—"}
            </span>
          </div>
          <div>
            <span className="block font-mono text-[10px] uppercase text-slate-500">P/B</span>
            <span className="font-mono text-xs font-bold text-slate-200">
              {pb ? `${pb.toFixed(2)}x` : "—"}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsBookmarked((prev) => !prev)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
              isBookmarked
                ? "border-cyan-400 bg-cyan-500/20 text-cyan-300"
                : "border-cyan-500/30 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-500/20"
            )}
          >
            <Bookmark className={cn("size-3.5", isBookmarked && "fill-cyan-300")} />
            <span>{isBookmarked ? "Đã lưu" : "Watchlist"}</span>
          </button>

          <button
            type="button"
            onClick={handleShare}
            title="Chia sẻ liên kết"
            className="rounded-lg border border-[#223040] bg-[#101722] p-2 text-slate-400 transition-colors hover:text-white"
          >
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Share2 className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
