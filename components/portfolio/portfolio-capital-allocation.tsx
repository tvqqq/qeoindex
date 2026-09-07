"use client"

import { memo, useMemo } from "react"

import type { PortfolioMeta } from "@/components/portfolio/portfolio-selector"
import { TradeSizeCalculator } from "@/components/portfolio/risk-sizing/trade-size-calculator"
import type { PortfolioPosition } from "@/modules/portfolio/pnl"
import { buildAccountEquityContext } from "@/modules/portfolio/risk-sizing/calculator"

interface PortfolioCapitalAllocationProps {
  portfolios: PortfolioMeta[]
  activePortfolioId: string
  positions: PortfolioPosition[]
  currentPrices: Record<string, number>
  totalRealizedPnlKvnd: number
}

export const PortfolioCapitalAllocation = memo(function PortfolioCapitalAllocation({
  portfolios,
  activePortfolioId,
  positions,
  currentPrices,
  totalRealizedPnlKvnd,
}: PortfolioCapitalAllocationProps) {
  const activePortfolio = portfolios.find((portfolio) => portfolio.id === activePortfolioId)
  const initialCapitalVnd = Number(activePortfolio?.initial_capital ?? 0)

  const accountEquityContext = useMemo(() => buildAccountEquityContext({
    initialCapitalVnd,
    totalRealizedPnlKvnd,
    positions: positions.map(({ ticker, openQty, avgCost }) => ({ ticker, openQty, avgCost })),
    currentPricesKvnd: currentPrices,
  }), [initialCapitalVnd, totalRealizedPnlKvnd, positions, currentPrices])

  if (!activePortfolioId || !activePortfolio) {
    return (
      <div className="rounded-3xl border border-[#2a2e40] bg-[#0c1017] p-6 font-ticker text-sm text-[var(--color-muted-2)]">
        Chọn một portfolio để lập Trade Size plan.
      </div>
    )
  }

  return (
    <TradeSizeCalculator
      portfolioId={activePortfolioId}
      accountEquityContext={accountEquityContext}
    />
  )
})
