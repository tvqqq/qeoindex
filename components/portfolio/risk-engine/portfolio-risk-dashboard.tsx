"use client"

import { ExternalCashFlowPanel } from "./external-cash-flow-panel"
import { PortfolioRiskDashboard as CorePortfolioRiskDashboard } from "./portfolio-risk-dashboard-core"

export function PortfolioRiskDashboard({ portfolioId }: { portfolioId: string }) {
  return (
    <div data-portfolio-risk-workspace className="space-y-4">
      <CorePortfolioRiskDashboard portfolioId={portfolioId} />
      <section className="overflow-hidden rounded-3xl border border-cyan-500/10 bg-[#0c1017] shadow-sm">
        <ExternalCashFlowPanel portfolioId={portfolioId} />
      </section>
    </div>
  )
}
