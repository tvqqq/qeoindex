"use client"

import { useState } from "react"
import { Bookmark, Check, Layers3, Share2, TrendingDown, TrendingUp, Trophy } from "lucide-react"
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react"

import { StockIdentity } from "@/components/stock-identity"
import { cn } from "@/modules/shared/ui/cn"

import { formatCompactNumber } from "./revamp/stock-card-metrics"
import { StockCardStat } from "./revamp/stock-card-stat"
import { StockPriceArena } from "./revamp/stock-price-arena"
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
    refPrice,
    ceilingPrice,
    floorPrice,
    highPrice,
    lowPrice,
    volume,
    marketCapT,
    pe,
    pb,
    roe,
    eps,
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

  const marketCapLabel = Number.isFinite(marketCapT) && marketCapT > 0
    ? `${marketCapT.toLocaleString("vi-VN")} tỷ`
    : "—"

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
        initial={shouldReduceMotion ? false : { opacity: 0, y: 10, scale: 0.995 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        whileHover={shouldReduceMotion ? undefined : { y: -2 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.28, ease: "easeOut" }}
        className="group relative overflow-hidden rounded-[28px] border border-indigo-300/[0.16] bg-[radial-gradient(circle_at_12%_0%,rgba(99,102,241,0.16),transparent_34%),radial-gradient(circle_at_88%_10%,rgba(34,211,238,0.09),transparent_30%),linear-gradient(145deg,#0a0f18_0%,#070b12_48%,#080c14_100%)] shadow-[0_22px_70px_rgba(0,0,0,0.34)] transition-shadow hover:shadow-[0_26px_80px_rgba(15,23,42,0.48)]"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:28px_28px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full border border-cyan-300/10 shadow-[0_0_80px_rgba(34,211,238,0.08)]"
        />

        <div className="relative p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-300/15 bg-indigo-300/[0.06] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-indigo-200/80">
              <Layers3 className="size-3" />
              <span>STOCK CARD</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-400">{exchange || "VN"}</span>
            </div>

            {typeof rank === "number" && rank > 0 ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1 font-mono text-[9px] font-black text-amber-200">
                <Trophy className="size-3" />
                Hạng #{rank}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <StockIdentity
                ticker={ticker}
                companyName={companyName}
                exchange={exchange}
                detail={sector}
                logoSize={48}
                className="min-w-0"
              />
              <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-slate-500">
                Tactical profile · đọc chỉ số thật trước, diễn giải và kịch bản nằm ở chart / AI Council bên dưới.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
              <div className="min-w-[170px] text-left lg:text-right">
                <div className={cn("font-mono text-3xl font-black tracking-tight sm:text-[34px]", priceColor)}>
                  {price ? price.toLocaleString("vi-VN") : "—"}
                </div>
                <div className="mt-1.5 flex items-center gap-2 lg:justify-end">
                  <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 font-mono text-xs font-black", changeTone)}>
                    {isUp ? <TrendingUp className="size-3" /> : isDown ? <TrendingDown className="size-3" /> : null}
                    {change > 0 ? `+${change.toLocaleString("vi-VN")}` : change.toLocaleString("vi-VN")}
                    <span className="opacity-60">/</span>
                    {changePct >= 0 ? `+${changePct.toFixed(2)}%` : `${changePct.toFixed(2)}%`}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBookmarked((prev) => !prev)}
                  className={cn(
                    "flex min-h-9 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-all",
                    isBookmarked
                      ? "border-indigo-300/30 bg-indigo-300/10 text-indigo-100 shadow-[0_0_20px_rgba(129,140,248,0.08)]"
                      : "border-white/[0.08] bg-black/20 text-slate-400 hover:border-white/20 hover:bg-white/[0.04] hover:text-white",
                  )}
                >
                  <Bookmark className={cn("size-3.5", isBookmarked && "fill-indigo-200 text-indigo-200")} />
                  <span className="hidden sm:inline">{isBookmarked ? "Đã lưu" : "Watchlist"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleShare}
                  title="Chia sẻ liên kết"
                  className="flex size-9 items-center justify-center rounded-xl border border-white/[0.08] bg-black/20 text-slate-500 transition-colors hover:border-white/[0.16] hover:bg-white/[0.04] hover:text-white"
                >
                  {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">CARD STATS</span>
              <span className="text-[9px] text-slate-600">Fundamental + market snapshot</span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <StockCardStat label="P/E" value={pe != null && Number.isFinite(pe) ? `${pe.toFixed(1)}x` : "—"} />
              <StockCardStat label="P/B" value={pb != null && Number.isFinite(pb) ? `${pb.toFixed(2)}x` : "—"} />
              <StockCardStat label="ROE" value={roe != null && Number.isFinite(roe) ? `${roe.toFixed(1)}%` : "—"} />
              <StockCardStat label="EPS" value={eps != null && Number.isFinite(eps) ? eps.toLocaleString("vi-VN", { maximumFractionDigits: 0 }) : "—"} detail="VND / cp" />
              <StockCardStat label="Khối lượng" value={formatCompactNumber(volume)} detail="phiên hiện tại" />
              <StockCardStat label="Vốn hóa" value={marketCapLabel} />
            </div>
          </div>

          <StockPriceArena
            floorPrice={floorPrice}
            lowPrice={lowPrice}
            refPrice={refPrice}
            currentPrice={price}
            highPrice={highPrice}
            ceilingPrice={ceilingPrice}
          />
        </div>
      </m.section>
    </LazyMotion>
  )
}
