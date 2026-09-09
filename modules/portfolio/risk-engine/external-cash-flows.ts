import type { ExternalCashFlow } from "./types.ts"

function isExactInstantCutoff(cutoff: string): boolean {
  return cutoff.includes("T")
}

export function externalFlowsOnOrBefore(
  flows: readonly ExternalCashFlow[],
  cutoff: string,
): ExternalCashFlow[] {
  const exactInstant = isExactInstantCutoff(cutoff)
  const cutoffMs = exactInstant ? Date.parse(cutoff) : null

  if (exactInstant && !Number.isFinite(cutoffMs)) return []

  return flows
    .filter((flow) => {
      if (exactInstant) {
        const effectiveMs = Date.parse(flow.effectiveAt)
        return Number.isFinite(effectiveMs) && effectiveMs <= cutoffMs!
      }
      return flow.effectiveDate <= cutoff
    })
    .sort((a, b) => {
      const timeDiff = new Date(a.effectiveAt).getTime() - new Date(b.effectiveAt).getTime()
      return timeDiff !== 0 ? timeDiff : a.id.localeCompare(b.id)
    })
}

export function sumExternalCashFlows(flows: readonly ExternalCashFlow[]): number {
  return Math.round(flows.reduce((sum, flow) => sum + flow.signedAmountVnd, 0))
}

export function flowAdjustedEquity(
  accountEquityVnd: number,
  cumulativeExternalFlowVnd: number,
): number {
  return Math.round(accountEquityVnd - cumulativeExternalFlowVnd)
}
