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
            className="h-24 animate-pulse rounded-3xl border border-[var(--color-border)] bg-[#0b0f13]"
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
    <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      {/* 1. Tổng giá trị tài sản */}
      <div className="relative overflow-hidden rounded-3xl border border-[#7057ff]/40 bg-gradient-to-br from-[#1c1833] via-[#121420] to-[#0e1017] p-5 shadow-[0_20px_50px_rgba(0,0,0,0.25)] transition-colors hover:border-[#7057ff]/60">
        <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-bl-[80px] bg-[#765cff]/15" />
        <div className="flex items-center justify-between">
          <span className="font-ticker text-xs font-bold uppercase tracking-wider text-purple-300">
            Tổng tài sản (NAV)
          </span>
          <Wallet className="h-4 w-4 text-purple-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-ticker text-2xl sm:text-3xl font-extrabold text-white tracking-tight tabular-nums">
            {formatVND(totalMarketValue)}
          </span>
        </div>
        <div className="mt-1 font-ticker text-xs text-[var(--color-muted-2)]">
          Vốn thực góp: <span className="font-semibold text-slate-300 italic">{formatVND(totalInvested)}</span>
        </div>
      </div>

      {/* 2. Lãi/lỗ chưa thực hiện */}
      <div className="rounded-3xl border border-[#272b3b] bg-[#0f121a] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.2)] transition-colors hover:border-[#383d54]">
        <div className="flex items-center justify-between">
          <span className="font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
            Lãi/Lỗ tạm tính
          </span>
          {isUnrealizedUp ? (
            <TrendingUp className="h-4 w-4 text-[var(--color-up)]" />
          ) : isUnrealizedDown ? (
            <TrendingDown className="h-4 w-4 text-[var(--color-down)]" />
          ) : (
            <DollarSign className="h-4 w-4 text-[var(--color-muted-2)]" />
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-ticker text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums",
              isUnrealizedUp
                ? "text-[var(--color-up)]"
                : isUnrealizedDown
                ? "text-[var(--color-down)]"
                : "text-white",
            )}
          >
            {isUnrealizedUp ? "+" : ""}
            {formatVND(totalUnrealizedPnl)}
          </span>
        </div>
        <div
          className={cn(
            "mt-1 font-ticker text-xs font-bold tabular-nums",
            isUnrealizedUp
              ? "text-[var(--color-up)]"
              : isUnrealizedDown
              ? "text-[var(--color-down)]"
              : "text-[var(--color-muted-2)]",
          )}
        >
          {isUnrealizedUp ? "▲ +" : isUnrealizedDown ? "▼ " : ""}
          {unrealizedPnlPct.toFixed(2)}% <span className="text-[11px] font-normal text-[var(--color-muted-2)] italic">(Tỷ suất danh mục)</span>
        </div>
      </div>

      {/* 3. Lãi/lỗ đã chốt */}
      <div className="rounded-3xl border border-[#272b3b] bg-[#0f121a] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.2)] transition-colors hover:border-[#383d54]">
        <div className="flex items-center justify-between">
          <span className="font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
            Lãi/Lỗ đã chốt
          </span>
          <DollarSign className="h-4 w-4 text-[var(--color-muted-2)]" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-ticker text-2xl sm:text-3xl font-extrabold tracking-tight tabular-nums",
              isRealizedUp
                ? "text-[var(--color-up)]"
                : isRealizedDown
                ? "text-[var(--color-down)]"
                : "text-white",
            )}
          >
            {isRealizedUp ? "+" : ""}
            {formatVND(totalRealizedPnl)}
          </span>
        </div>
        <div className="mt-1 font-ticker text-xs text-[var(--color-muted-2)] italic">
          Lợi nhuận thực nhận
        </div>
      </div>

      {/* 4. Số vị thế đang mở */}
      <div className="rounded-3xl border border-[#272b3b] bg-[#0f121a] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.2)] transition-colors hover:border-[#383d54]">
        <div className="flex items-center justify-between">
          <span className="font-ticker text-xs font-bold uppercase tracking-wider text-[var(--color-muted-2)]">
            Vị thế nắm giữ
          </span>
          <PieChart className="h-4 w-4 text-[var(--color-muted-2)]" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="font-ticker text-2xl sm:text-3xl font-extrabold text-white tracking-tight tabular-nums">
            {positions.length}
          </span>
          <span className="font-ticker text-xs font-medium text-[var(--color-muted-2)]">mã cổ phiếu</span>
        </div>
        <div className="mt-1 font-ticker text-xs text-[var(--color-muted-2)] italic">
          {positions.length > 0 ? "Đang phân bổ rủi ro" : "Chưa có vị thế mở"}
        </div>
      </div>
    </div>
  )
}
