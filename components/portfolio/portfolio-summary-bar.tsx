"use client"

import { PortfolioBattleHud, type PortfolioBattleHudProps } from "@/components/portfolio/revamp/portfolio-battle-hud"

export type PortfolioSummaryBarProps = PortfolioBattleHudProps

export function PortfolioSummaryBar(props: PortfolioSummaryBarProps) {
  return <PortfolioBattleHud {...props} />
}
