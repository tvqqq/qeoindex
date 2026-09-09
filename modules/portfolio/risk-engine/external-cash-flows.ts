import type { ExternalCashFlow } from "./types.ts"

export function externalFlowsOnOrBefore(
  flows: readonly ExternalCashFlow[],
  effectiveDate: string,
): ExternalCashFlow[] {
  return flows
    .filter((flow) => flow.effectiveDate <= effectiveDate)
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
