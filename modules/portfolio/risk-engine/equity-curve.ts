import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"
import {
  externalFlowsOnOrBefore,
  flowAdjustedEquity,
  sumExternalCashFlows,
} from "./external-cash-flows.ts"
import type {
  AccountEquitySnapshot,
  DrawdownSnapshot,
  EquityPoint,
  ExternalCashFlow,
  FundingHistoryStatus,
} from "./types.ts"

function roundVnd(value: number): number {
  return Math.round(value)
}

export function buildCurrentAccountEquity({
  initialCapitalVnd,
  transactions,
  currentPricesKvnd,
  externalCashFlows = [],
  fundingHistoryStatus = "known",
}: {
  initialCapitalVnd: number
  transactions: RawTransaction[]
  currentPricesKvnd: Record<string, number>
  externalCashFlows?: ExternalCashFlow[]
  fundingHistoryStatus?: FundingHistoryStatus
}): AccountEquitySnapshot {
  const summary = computePortfolioPositions(transactions)
  const remainingOpenCostBasisVnd = roundVnd(
    summary.positions.reduce((sum, position) => sum + position.totalInvested * 1000, 0),
  )
  const realizedPnlVnd = roundVnd(summary.totalRealizedPnl * 1000)
  const cumulativeExternalFlowVnd = sumExternalCashFlows(externalCashFlows)
  const estimatedCashVnd = roundVnd(
    initialCapitalVnd
      + cumulativeExternalFlowVnd
      + realizedPnlVnd
      - remainingOpenCostBasisVnd,
  )
  const missingPriceTickers = summary.positions
    .filter((position) => {
      const price = currentPricesKvnd[position.ticker]
      return !Number.isFinite(price) || !(price > 0)
    })
    .map((position) => position.ticker)

  if (missingPriceTickers.length > 0) {
    return {
      equityVnd: null,
      flowAdjustedEquityVnd: null,
      cumulativeExternalFlowVnd,
      fundingHistoryStatus,
      estimatedCashVnd,
      marketValueVnd: null,
      realizedPnlVnd,
      unrealizedPnlVnd: null,
      missingPriceTickers,
      completeness: "insufficient",
      fundingWarning: estimatedCashVnd < 0,
    }
  }

  const marketValueVnd = roundVnd(
    summary.positions.reduce(
      (sum, position) => sum + currentPricesKvnd[position.ticker]! * position.openQty * 1000,
      0,
    ),
  )
  const unrealizedPnlVnd = roundVnd(marketValueVnd - remainingOpenCostBasisVnd)
  const equityVnd = roundVnd(estimatedCashVnd + marketValueVnd)

  return {
    equityVnd,
    flowAdjustedEquityVnd: flowAdjustedEquity(equityVnd, cumulativeExternalFlowVnd),
    cumulativeExternalFlowVnd,
    fundingHistoryStatus,
    estimatedCashVnd,
    marketValueVnd,
    realizedPnlVnd,
    unrealizedPnlVnd,
    missingPriceTickers: [],
    completeness: "complete",
    fundingWarning: estimatedCashVnd < 0,
  }
}

function pointPerformanceEquity(point: EquityPoint): number | null {
  return point.flowAdjustedEquityVnd ?? point.equityVnd
}

export function deriveCurrentDrawdown(points: EquityPoint[]): DrawdownSnapshot {
  if (
    points.length === 0
    || points.some((point) => (
      point.status !== "complete"
      || pointPerformanceEquity(point) == null
      || point.fundingHistoryStatus === "legacy_unrecorded"
    ))
  ) {
    return {
      peakEquityVnd: null,
      peakAt: null,
      drawdownVnd: null,
      drawdownPercent: null,
      completeness: "insufficient",
    }
  }

  let peakEquityVnd = Number.NEGATIVE_INFINITY
  let peakAt: string | null = null
  for (const point of points) {
    const equityVnd = pointPerformanceEquity(point)!
    if (equityVnd > peakEquityVnd) {
      peakEquityVnd = equityVnd
      peakAt = point.key
    }
  }

  const currentEquityVnd = pointPerformanceEquity(points.at(-1)!)!
  const drawdownVnd = roundVnd(Math.max(0, peakEquityVnd - currentEquityVnd))
  const drawdownPercent = peakEquityVnd > 0
    ? (drawdownVnd / peakEquityVnd) * 100
    : null

  return {
    peakEquityVnd,
    peakAt,
    drawdownVnd,
    drawdownPercent,
    completeness: drawdownPercent == null ? "insufficient" : "complete",
  }
}

export function buildEquityCurve({
  initialCapitalVnd,
  transactions,
  sessions,
  rawDailyCloseKvnd,
  current,
  externalCashFlows = [],
  fundingHistoryStatus = "known",
}: {
  initialCapitalVnd: number
  transactions: RawTransaction[]
  sessions: string[]
  rawDailyCloseKvnd: Record<string, Record<string, number>>
  current?: { key: string; pricesKvnd: Record<string, number> }
  externalCashFlows?: ExternalCashFlow[]
  fundingHistoryStatus?: FundingHistoryStatus
}): { points: EquityPoint[]; currentDrawdown: DrawdownSnapshot } {
  const baselineEquityVnd = Number.isFinite(initialCapitalVnd)
    ? roundVnd(initialCapitalVnd)
    : null
  const points: EquityPoint[] = [{
    key: "baseline",
    kind: "baseline",
    equityVnd: baselineEquityVnd,
    flowAdjustedEquityVnd: baselineEquityVnd,
    externalFlowVnd: 0,
    cumulativeExternalFlowVnd: 0,
    fundingHistoryStatus,
    status: Number.isFinite(initialCapitalVnd) ? "complete" : "incomplete",
    missingTickers: [],
  }]
  let representedExternalFlowVnd = 0

  for (const session of sessions) {
    const transactionsToDate = transactions.filter(
      (transaction) => transaction.transaction_date <= session,
    )
    const flowsToDate = externalFlowsOnOrBefore(externalCashFlows, session)
    const snapshot = buildCurrentAccountEquity({
      initialCapitalVnd,
      transactions: transactionsToDate,
      currentPricesKvnd: rawDailyCloseKvnd[session] ?? {},
      externalCashFlows: flowsToDate,
      fundingHistoryStatus,
    })
    const externalFlowVnd = roundVnd(
      snapshot.cumulativeExternalFlowVnd - representedExternalFlowVnd,
    )
    representedExternalFlowVnd = snapshot.cumulativeExternalFlowVnd
    points.push({
      key: session,
      kind: "daily",
      equityVnd: snapshot.equityVnd,
      flowAdjustedEquityVnd: snapshot.flowAdjustedEquityVnd,
      externalFlowVnd,
      cumulativeExternalFlowVnd: snapshot.cumulativeExternalFlowVnd,
      fundingHistoryStatus,
      status: snapshot.completeness === "complete" ? "complete" : "incomplete",
      missingTickers: snapshot.missingPriceTickers,
    })
  }

  if (current) {
    const snapshot = buildCurrentAccountEquity({
      initialCapitalVnd,
      transactions,
      currentPricesKvnd: current.pricesKvnd,
      externalCashFlows,
      fundingHistoryStatus,
    })
    const externalFlowVnd = roundVnd(
      snapshot.cumulativeExternalFlowVnd - representedExternalFlowVnd,
    )
    points.push({
      key: current.key,
      kind: "current",
      equityVnd: snapshot.equityVnd,
      flowAdjustedEquityVnd: snapshot.flowAdjustedEquityVnd,
      externalFlowVnd,
      cumulativeExternalFlowVnd: snapshot.cumulativeExternalFlowVnd,
      fundingHistoryStatus,
      status: snapshot.completeness === "complete" ? "complete" : "incomplete",
      missingTickers: snapshot.missingPriceTickers,
    })
  }

  return {
    points,
    currentDrawdown: deriveCurrentDrawdown(points),
  }
}
