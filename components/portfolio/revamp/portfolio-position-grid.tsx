"use client"

import { memo, useMemo } from "react"

import { TacticalPositionCard, type TacticalPositionCardData } from "@/components/portfolio/revamp/tactical-position-card"
import type { PortfolioPosition } from "@/modules/portfolio/pnl"

export interface PortfolioPositionGridProps {
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  loading: boolean
  onAddTransaction: (ticker?: string) => void
}

export const PortfolioPositionGrid = memo(function PortfolioPositionGrid({
  positions,
  currentPrices,
  loading,
  onAddTransaction,
}: PortfolioPositionGridProps) {
  const cards = useMemo<TacticalPositionCardData[]>(() => positions.map((pos) => {
    const currentPrice = currentPrices[pos.ticker] ?? pos.avgCost
    const marketValue = currentPrice * pos.openQty
    const unrealizedPnl = (currentPrice - pos.avgCost) * pos.openQty
    const unrealizedPnlPct = pos.avgCost > 0
      ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100
      : 0

    return {
      ticker: pos.ticker,
      openQty: pos.openQty,
      avgCost: pos.avgCost,
      currentPrice,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      targetPrice: pos.targetPrice,
      stopLoss: pos.stopLoss,
    }
  }), [positions, currentPrices])

  if (loading && cards.length === 0) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-72 animate-pulse rounded-3xl border border-white/[0.08] bg-white/[0.03]" />
        ))}
      </div>
    )
  }

  if (cards.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/[0.1] bg-white/[0.02] px-6 py-10 text-center">
        <p className="font-ticker text-sm font-bold text-slate-200">Chưa có vị thế đang mở</p>
        <p className="mt-1 text-sm text-slate-500">Ghi nhận giao dịch để xây dựng đội hình danh mục.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <TacticalPositionCard
          key={card.ticker}
          position={card}
          onAddTransaction={onAddTransaction}
        />
      ))}
    </div>
  )
})
