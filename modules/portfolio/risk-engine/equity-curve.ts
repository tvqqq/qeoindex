import { computePortfolioPositions, type RawTransaction } from "../pnl.ts"
import type {
  AccountEquitySnapshot,
  DrawdownSnapshot,
  EquityPoint,
} from "./types.ts"

function roundVnd(value: number): number {
  return Math.round(value)
}

export function buildCurrentAccountEquity({
  initialCapitalVnd,
  transactions,
  currentPricesKvnd,
}: {
  initialCapitalVnd: number
  transactions: RawTransaction[]
  currentPricesKvnd: Record<string, number>
}): AccountEquitySnapshot {
  const summary = computePortfolioPositions(transactions)
  const remainingOpenCostBasisVnd = roundVnd(
    summary.positions.reduce((sum, position) => sum + position.totalInvested * 1000, 0),
  )
  const realizedPnlVnd = roundVnd(summary.totalRealizedPnl * 1000)
  const estimatedCashVnd = roundVnd(
    initialCapitalVnd + realizedPnlVnd - remainingOpenCostBasisVnd,
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

  return {
    equityVnd: roundVnd(estimatedCashVnd + marketValueVnd),
    estimatedCashVnd,
    marketValueVnd,
    realizedPnlVnd,
    unrealizedPnlVnd,
    missingPriceTickers: [],
    completeness: "complete",
    fundingWarning: estimatedCashVnd < 0,
  }
}

export function deriveCurrentDrawdown(points: EquityPoint[]): DrawdownSnapshot {
  if (
    points.length === 0
    || points.some((point) => point.status !== "complete" || point.equityVnd == null)
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
    if (point.equityVnd! > peakEquityVnd) {
      peakEquityVnd = point.equityVnd!
      peakAt = point.key
    }
  }

  const currentEquityVnd = points.at(-1)!.equityVnd!
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
}: {
  initialCapitalVnd: number
  transactions: RawTransaction[]
  sessions: string[]
  rawDailyCloseKvnd: Record<string, Record<string, number>>
  current?: { key: string; pricesKvnd: Record<string, number> }
}): { points: EquityPoint[]; currentDrawdown: DrawdownSnapshot } {
  const points: EquityPoint[] = [{
    key: "baseline",
    kind: "baseline",
    equityVnd: Number.isFinite(initialCapitalVnd) ? roundVnd(initialCapitalVnd) : null,
    status: Number.isFinite(initialCapitalVnd) ? "complete" : "incomplete",
    missingTickers: [],
  }]

  for (const session of sessions) {
    const transactionsToDate = transactions.filter(
      (transaction) => transaction.transaction_date <= session,
    )
    const snapshot = buildCurrentAccountEquity({
      initialCapitalVnd,
      transactions: transactionsToDate,
      currentPricesKvnd: rawDailyCloseKvnd[session] ?? {},
    })
    points.push({
      key: session,
      kind: "daily",
      equityVnd: snapshot.equityVnd,
      status: snapshot.completeness === "complete" ? "complete" : "incomplete",
      missingTickers: snapshot.missingPriceTickers,
    })
  }

  if (current) {
    const snapshot = buildCurrentAccountEquity({
      initialCapitalVnd,
      transactions,
      currentPricesKvnd: current.pricesKvnd,
    })
    points.push({
      key: current.key,
      kind: "current",
      equityVnd: snapshot.equityVnd,
      status: snapshot.completeness === "complete" ? "complete" : "incomplete",
      missingTickers: snapshot.missingPriceTickers,
    })
  }

  return {
    points,
    currentDrawdown: deriveCurrentDrawdown(points),
  }
}
