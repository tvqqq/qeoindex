"use client"

import { useState } from "react"
import { Bookmark, Check, Share2, TrendingDown, TrendingUp, Trophy } from "lucide-react"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { StockIdentity } from "@/components/stock-identity"
import { cn } from "@/modules/shared/ui/cn"

import { QeoCompositeTrend } from "./qeo-composite-trend"
import type { StockDetailData } from "./types"

export function StockCompanyHeader({ data }: { data: StockDetailData }) {
  const {
    ticker,
    companyName,
    exchange,
    sector,
    rank,
    price,
    change,
    changePct,
    ceilingPrice,
    floorPrice,
  } = data

  const [isBookmarked, setIsBookmarked] = useState(false)
  const [copied, setCopied] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  const isUp = change > 0
  const isDown = change < 0
  const isCeiling = ceilingPrice > 0 && price >= ceilingPrice
  const isFloor = floorPrice > 0 && price <= floorPrice

  const priceColor = isCeiling
    ? "text-fuchsia-300"
    : isFloor
      ? "text-cyan-300"
      : isUp
        ? "text-emerald-400"
        : isDown
          ? "text-rose-400"
          : "text-slate-100"

  const changeTone = isUp
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
    : isDown
      ? "border-rose-500/25 bg-rose-500/10 text-rose-300"
      : "border-white/10 bg-white/[0.05] text-slate-300"

  function handleShare() {
    if (typeof window === "undefined") return
    void navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.section
        data-qeo174-strategy-card
        initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.997 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        whileHover={shouldReduceMotion ? undefined : { y: -1 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: "easeOut" }}
        className="group relative overflow-hidden rounded-2xl border border-indigo-300/[0.14] bg-[radial-gradient(circle_at_12%_0%,rgba(99,102,241,0.14),transparent_34%),radial-gradient(circle_at_88%_10%,rgba(34,211,238,0.07),transparent_30%),linear-gradient(145deg,#0a0f18_0%,#070b12_48%,#080c14_100%)] shadow-[0_16px_52px_rgba(0,0,0,0.3)] transition-shadow hover:shadow-[0_20px_62px_rgba(15,23,42,0.42)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.1] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:28px_28px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full border border-cyan-300/10 shadow-[0_0_80px_rgba(34,211,238,0.08)]"
        />

        <div className="relative p-3 sm:p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(220px,300px)_auto] lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <StockIdentity
                ticker={ticker}
                companyName={companyName}
                exchange={exchange}
                detail={sector}
                logoSize={42}
                className="min-w-0 flex-1"
              />

              {typeof rank === "number" && rank > 0 ? (
                <div className="hidden shrink-0 items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 font-mono text-[9px] font-black text-amber-200 sm:inline-flex">
                  <Trophy className="size-3" />
                  #{rank}
                </div>
              ) : null}
            </div>

            <QeoCompositeTrend row={data.ratingRow} />

            <div className="flex flex-wrap items-center justify-between gap-2 lg:justify-end">
              <div className="min-w-[154px] text-left lg:text-right">
                <div className={cn("font-mono text-3xl font-black tracking-tight sm:text-[34px]", priceColor)}>
                  {price ? price.toLocaleString("vi-VN") : "—"}
                </div>
                <div className="mt-1 flex items-center gap-2 lg:justify-end">
                  <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 font-mono text-[11px] font-black", changeTone)}>
                    {isUp ? <TrendingUp className="size-3" /> : isDown ? <TrendingDown className="size-3" /> : null}
                    {change > 0 ? `+${change.toLocaleString("vi-VN")}` : change.toLocaleString("vi-VN")}
                    <span className="opacity-60">/</span>
                    {changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsBookmarked((prev) => !prev)}
                  aria-label={isBookmarked ? "Bỏ khỏi watchlist" : "Thêm vào watchlist"}
                  title={isBookmarked ? "Bỏ khỏi watchlist" : "Thêm vào watchlist"}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl border transition-all",
                    isBookmarked
                      ? "border-indigo-300/30 bg-indigo-300/10 text-indigo-100 shadow-[0_0_20px_rgba(129,140,248,0.08)]"
                      : "border-white/[0.08] bg-black/20 text-slate-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-white",
                  )}
                >
                  <Bookmark className={cn("size-3.5", isBookmarked && "fill-indigo-200 text-indigo-200")} />
                </button>

                <button
                  type="button"
                  onClick={handleShare}
                  aria-label="Chia sẻ liên kết"
                  title="Chia sẻ liên kết"
                  className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-black/20 text-slate-500 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-white"
                >
                  {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </m.section>
    </LazyMotion>
  )
}
