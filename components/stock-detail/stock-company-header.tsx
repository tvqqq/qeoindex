"use client"

import React, { useState } from "react"
import { Bookmark, Check, ExternalLink, Share2, Sparkles, TrendingDown, TrendingUp } from "lucide-react"

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
    ? "text-purple-300"
    : isFloor
    ? "text-cyan-300"
    : isUp
    ? "text-emerald-300"
    : isDown
    ? "text-rose-300"
    : "text-amber-300"

  const changeBg = isUp
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
    : isDown
    ? "border-rose-400/25 bg-rose-400/10 text-rose-300"
    : "border-amber-400/25 bg-amber-400/10 text-amber-300"

  function handleShare() {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,.08),transparent_32%),radial-gradient(circle_at_top_left,rgba(139,92,246,.08),transparent_28%),linear-gradient(145deg,#0b1119,#070b10)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Ticker Symbol with Neon Glow Avatar */}
        <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
          <div className="relative flex size-12 sm:size-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/30 bg-gradient-to-br from-cyan-500/20 via-sky-500/15 to-violet-500/20 shadow-[0_0_24px_-4px_rgba(0,240,255,0.4),inset_0_1px_0_rgba(255,255,255,0.22)]">
            <span className="font-mono text-lg font-black text-cyan-200 drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]">
              {ticker}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="neon-ticker-glow font-ticker text-3xl font-extrabold italic tracking-[-0.03em] text-cyan-300 sm:text-4xl">
                {ticker}
              </h1>
              <span className="rounded-full border border-white/[0.1] bg-white/[0.04] px-2.5 py-0.5 font-mono text-[10px] font-bold text-slate-300">
                {exchange || "HOSE"}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-0.5 text-[10px] font-semibold text-slate-400">
                {sector || "Thị trường Việt Nam"}
              </span>
            </div>
            <p className="mt-1 truncate text-xs sm:text-sm font-medium text-slate-300 max-w-[420px]" title={companyName}>
              {companyName}
            </p>
          </div>
        </div>

        {/* Realtime Price & Changes */}
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="text-right">
            <div className={cn("font-mono text-3xl font-black sm:text-4xl tracking-tight", priceColor)}>
              {price ? price.toLocaleString("vi-VN") : "—"}
            </div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 font-mono text-xs font-black", changeBg)}>
                {isUp ? <TrendingUp className="size-3" /> : isDown ? <TrendingDown className="size-3" /> : null}
                {change > 0 ? `+${change.toLocaleString()}` : change.toLocaleString()} ({changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`})
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsBookmarked((prev) => !prev)}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all",
                isBookmarked
                  ? "border-cyan-400/40 bg-cyan-400/15 text-cyan-200 shadow-[0_0_12px_rgba(0,240,255,0.25)]"
                  : "border-white/[0.08] bg-[#0a0f16] text-slate-300 hover:border-cyan-400/30 hover:text-cyan-200"
              )}
            >
              <Bookmark className={cn("size-3.5", isBookmarked && "fill-cyan-300 text-cyan-300")} />
              <span className="hidden sm:inline">{isBookmarked ? "Đã lưu" : "Watchlist"}</span>
            </button>

            <button
              type="button"
              onClick={handleShare}
              title="Chia sẻ liên kết"
              className="rounded-xl border border-white/[0.08] bg-[#0a0f16] p-2 text-slate-400 transition-colors hover:border-white/[0.15] hover:text-white"
            >
              {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Secondary Data Strip (TC, Trần, Sàn, Khối lượng, Vốn hóa, P/E, P/B) */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5 text-xs text-slate-400">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px]">
          <span>TC: <b className="text-slate-300">{refPrice ? refPrice.toLocaleString() : "—"}</b></span>
          <span>Trần: <b className="text-purple-300">{ceilingPrice ? ceilingPrice.toLocaleString() : "—"}</b></span>
          <span>Sàn: <b className="text-cyan-300">{floorPrice ? floorPrice.toLocaleString() : "—"}</b></span>
          <span>Cao: <b className="text-emerald-300">{highPrice ? highPrice.toLocaleString() : "—"}</b></span>
          <span>Thấp: <b className="text-rose-300">{lowPrice ? lowPrice.toLocaleString() : "—"}</b></span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px]">
          <span>KL: <b className="text-slate-200">{volume ? `${(volume / 1_000_000).toFixed(2)}M` : "—"}</b></span>
          <span>Vốn hóa: <b className="text-slate-200">{marketCapT ? `${marketCapT.toLocaleString()} Tỷ` : "—"}</b></span>
          <span>P/E: <b className="text-slate-200">{pe ? `${pe.toFixed(1)}x` : "—"}</b></span>
          <span>P/B: <b className="text-slate-200">{pb ? `${pb.toFixed(2)}x` : "—"}</b></span>
        </div>
      </div>
    </div>
  )
}
