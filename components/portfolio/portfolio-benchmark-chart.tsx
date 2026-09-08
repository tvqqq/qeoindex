"use client"

import { PortfolioPerformanceDashboard } from "@/components/portfolio/performance/performance-dashboard"

/**
 * Compatibility slot for the existing portfolio tab wiring.
 * QEO-142 removes all benchmark fetching/calculation ownership from this component;
 * the canonical performance dashboard owns the single performance fetch.
 */
export function PortfolioBenchmarkChart({ portfolioId }: { portfolioId: string }) {
  return <PortfolioPerformanceDashboard portfolioId={portfolioId} />
}
