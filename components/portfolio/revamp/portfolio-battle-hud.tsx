"use client"

import { useMemo, type ReactNode } from "react"
import { CircleDollarSign, Layers3, TrendingDown, TrendingUp, WalletCards } from "lucide-react"

import type { PortfolioPosition } from "@/modules/portfolio/pnl"
import { cn } from "@/modules/shared/ui/cn"

export type PortfolioBattleHudProps = {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading?: boolean
}

function formatVndKvnd(kVnd: number): string {
  const abs = Math.abs(kVnd)
  if (abs >= 1_000_000) return `${(kVnd / 1_000_000).toFixed(2)} tỷ`
  if (abs >= 1_000) return `${(kVnd / 1_000).toFixed(1)} tr`
  return `${kVnd.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} k₫`
}

export function PortfolioBattleHud({ positions, currentPrices, loading = false }: PortfolioBattleHudProps) {
  const summary = useMemo(() => {
    let totalMarketValue = 0
    let totalInvested = 0
    let totalUnrealizedPnl = 0
    let totalRealizedPnl = 0

    for (const pos of positions) {
      const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
      const marketValue = currentPrice * pos.openQty
      const invested = pos.avgCost * pos.openQty
      const unrealized = (currentPrice - pos.avgCost) * pos.openQty

      totalMarketValue += marketValue
      totalInvested += invested
      totalUnrealizedPnl += unrealized
      totalRealizedPnl += pos.realizedPnl
    }

    return {
      totalMarketValue,
      totalInvested,
      totalUnrealizedPnl,
      totalRealizedPnl,
      unrealizedPnlPercent: totalInvested > 0 ? (totalUnrealizedPnl / totalInvested) * 100 : 0,
    }
  }, [positions, currentPrices])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Đang tải tổng quan danh mục">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-3xl border border-white/10 bg-white/[0.025]" />
        ))}
      </div>
    )
  }

  const unrealizedDirection = summary.totalUnrealizedPnl > 0 ? "up" : summary.totalUnrealizedPnl < 0 ? "down" : "flat"
  const realizedDirection = summary.totalRealizedPnl > 0 ? "up" : summary.totalRealizedPnl < 0 ? "down" : "flat"

  return (
    <section aria-label="Battle HUD danh mục" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <HudCard
        label="Tổng tài sản (NAV)"
        value={formatVndKvnd(summary.totalMarketValue)}
        note={`Vốn thực góp: ${formatVndKvnd(summary.totalInvested)}`}
        icon={<WalletCards className="h-5 w-5" />}
        emphasis
      />
      <HudCard
        label="Lãi/Lỗ tạm tính"
        value={`${summary.totalUnrealizedPnl > 0 ? "+" : ""}${formatVndKvnd(summary.totalUnrealizedPnl)}`}
        note={`${summary.unrealizedPnlPercent > 0 ? "+" : ""}${summary.unrealizedPnlPercent.toFixed(2)}% trên vốn đầu tư`}
        icon={unrealizedDirection === "up" ? <TrendingUp className="h-5 w-5" /> : unrealizedDirection === "down" ? <TrendingDown className="h-5 w-5" /> : <CircleDollarSign className="h-5 w-5" />}
        direction={unrealizedDirection}
      />
      <HudCard
        label="Lãi/Lỗ đã chốt"
        value={`${summary.totalRealizedPnl > 0 ? "+" : ""}${formatVndKvnd(summary.totalRealizedPnl)}`}
        note="Lợi nhuận đã ghi nhận"
        icon={<CircleDollarSign className="h-5 w-5" />}
        direction={realizedDirection}
      />
      <HudCard
        label="Vị thế nắm giữ"
        value={positions.length.toLocaleString("vi-VN")}
        note={positions.length > 0 ? "Mã cổ phiếu đang mở" : "Chưa có vị thế mở"}
        icon={<Layers3 className="h-5 w-5" />}
      />
    </section>
  )
}

function HudCard({
  label,
  value,
  note,
  icon,
  direction = "flat",
  emphasis = false,
}: {
  label: string
  value: string
  note: string
  icon: ReactNode
  direction?: "up" | "down" | "flat"
  emphasis?: boolean
}) {
  return (
    <div
      className={cn(
        "relative min-w-0 overflow-hidden rounded-3xl border p-5 shadow-[0_18px_55px_rgba(0,0,0,0.2)]",
        emphasis
          ? "border-violet-400/35 bg-gradient-to-br from-violet-500/15 via-[#111521] to-[#0c1017]"
          : "border-white/10 bg-[#0d1118]",
      )}
    >
      <div className="flex items-center justify-between gap-3 text-slate-400">
        <span className="text-sm font-semibold">{label}</span>
        <span className={cn(
          "shrink-0",
          direction === "up" ? "text-[var(--color-up)]" : direction === "down" ? "text-[var(--color-down)]" : emphasis ? "text-violet-300" : "text-slate-500",
        )}>{icon}</span>
      </div>
      <p className={cn(
        "mt-3 truncate text-3xl font-black tracking-tight tabular-nums sm:text-4xl",
        direction === "up" ? "text-[var(--color-up)]" : direction === "down" ? "text-[var(--color-down)]" : "text-white",
      )}>{value}</p>
      <p className="mt-2 text-sm leading-5 text-slate-400">{note}</p>
    </div>
  )
}
