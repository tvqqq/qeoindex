"use client"

import React, { useMemo } from "react"
import { TrendingUp, TrendingDown, DollarSign, PieChart, Wallet } from "lucide-react"

import { PortfolioPosition } from "@/lib/portfolio/pnl"
import { cn } from "@/lib/utils"

function formatVND(kVND: number): string {
  const abs = Math.abs(kVND)
  if (abs >= 1_000_000) return `${(kVND / 1_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000) return `${(kVND / 1_000).toFixed(1)} tr`
  return `${kVND.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} k₫`
}

interface PortfolioSummaryBarProps {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading?: boolean
}

export function PortfolioSummaryBar({
  positions,
  currentPrices,
  loading = false,
}: PortfolioSummaryBarProps) {
  const { totalMarketValue, totalUnrealizedPnl, totalRealizedPnl, totalInvested, unrealizedPnlPct } =
    useMemo(() => {
      let marketVal = 0
      let invested = 0
      let unrealized = 0
      let realized = 0

      for (const pos of positions) {
        const price = currentPrices[pos.ticker] ?? pos.avgCost
        const curMktVal = price * pos.openQty
        const curInvested = pos.avgCost * pos.openQty
        marketVal += curMktVal
        invested += curInvested
        unrealized += (price - pos.avgCost) * pos.openQty
        realized += pos.realizedPnl
      }

      const pnlPct = invested > 0 ? (unrealized / invested) * 100 : 0

      return {
        totalMarketValue: marketVal,
        totalInvested: invested,
        totalUnrealizedPnl: unrealized,
        totalRealizedPnl: realized,
        unrealizedPnlPct: pnlPct,
      }
    }, [positions, currentPrices])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border border-[var(--color-border)] bg-[#0b0f13]"
          />
        ))}
      </div>
    )
  }

  const isUnrealizedUp = totalUnrealizedPnl > 0
  const isUnrealizedDown = totalUnrealizedPnl < 0

  const isRealizedUp = totalRealizedPnl > 0
  const isRealizedDown = totalRealizedPnl < 0

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* 1. Tổng giá trị tài sản */}
      <div className="relative overflow-hidden rounded-3xl border border-[#7057ff]/35 bg-gradient-to-br from-[#1b1730] to-[#12141e] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.2)]">
        <div className="pointer-events-none absolute right-0 top-0 h-20 w-20 rounded-bl-[64px] bg-[#765cff]/10" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-muted-2)]">Tổng tài sản</span>
          <Wallet className="h-4 w-4 text-[var(--color-muted-2)]" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-ticker text-lg font-bold text-white tabular-nums sm:text-xl">
            {formatVND(totalMarketValue)}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted-2)]">
          Vốn: {formatVND(totalInvested)}
        </div>
      </div>

      {/* 2. Lãi/lỗ chưa thực hiện */}
      <div className="rounded-3xl border border-[#252837] bg-[#11131c] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-muted-2)]">Lãi/Lỗ tạm tính</span>
          {isUnrealizedUp ? (
            <TrendingUp className="h-4 w-4 text-[var(--color-up)]" />
          ) : isUnrealizedDown ? (
            <TrendingDown className="h-4 w-4 text-[var(--color-down)]" />
          ) : (
            <DollarSign className="h-4 w-4 text-[var(--color-muted-2)]" />
          )}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-ticker text-lg font-bold tabular-nums sm:text-xl",
              isUnrealizedUp
                ? "text-[var(--color-up)]"
                : isUnrealizedDown
                ? "text-[var(--color-down)]"
                : "text-[var(--color-foreground)]",
            )}
          >
            {isUnrealizedUp ? "+" : ""}
            {formatVND(totalUnrealizedPnl)}
          </span>
        </div>
        <div
          className={cn(
            "mt-0.5 font-ticker text-[11px] font-medium tabular-nums",
            isUnrealizedUp
              ? "text-[var(--color-up)]"
              : isUnrealizedDown
              ? "text-[var(--color-down)]"
              : "text-[var(--color-muted-2)]",
          )}
        >
          {isUnrealizedUp ? "▲ +" : isUnrealizedDown ? "▼ " : ""}
          {unrealizedPnlPct.toFixed(2)}%
        </div>
      </div>

      {/* 3. Lãi/lỗ đã chốt */}
      <div className="rounded-3xl border border-[#252837] bg-[#11131c] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-muted-2)]">Lãi/Lỗ đã chốt</span>
          <DollarSign className="h-4 w-4 text-[var(--color-muted-2)]" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-ticker text-lg font-bold tabular-nums sm:text-xl",
              isRealizedUp
                ? "text-[var(--color-up)]"
                : isRealizedDown
                ? "text-[var(--color-down)]"
                : "text-[var(--color-foreground)]",
            )}
          >
            {isRealizedUp ? "+" : ""}
            {formatVND(totalRealizedPnl)}
          </span>
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted-2)]">Toàn thời gian</div>
      </div>

      {/* 4. Số vị thế đang mở */}
      <div className="rounded-3xl border border-[#252837] bg-[#11131c] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.16)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-muted-2)]">Số mã nắm giữ</span>
          <PieChart className="h-4 w-4 text-[var(--color-muted-2)]" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-ticker text-lg font-bold text-white tabular-nums sm:text-xl">
            {positions.length}
          </span>
          <span className="text-xs text-[var(--color-muted-2)]">mã</span>
        </div>
        <div className="mt-0.5 text-[11px] text-[var(--color-muted-2)]">
          {positions.length > 0 ? "Đang phân bổ" : "Trống"}
        </div>
      </div>
    </div>
  )
}
