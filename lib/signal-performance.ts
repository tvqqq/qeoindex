import type { TradeRecommendation } from "@/lib/signal-data"

export interface PerformancePoint {
  label: string
  strategy: number
  vnindex: number | null
}

export interface RecommendationPerformance {
  total: number
  open: number
  closed: number
  wins: number
  losses: number
  flats: number
  winRate: number | null
  avgReturn: number | null
  avgVnindexReturn: number | null
  avgAlpha: number | null
  alphaWinRate: number | null
  avgWin: number | null
  avgLoss: number | null
  payoff: number | null
  bestReturn: number | null
  worstReturn: number | null
  curve: PerformancePoint[]
}

function avg(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function buildRecommendationPerformance(rows: TradeRecommendation[]): RecommendationPerformance {
  const completed = rows
    .filter((row) => row.returnPct != null && (row.status === "Closed" || row.status === "Stopped"))
    .sort((a, b) => (a.sellSignal || a.buySignal).localeCompare(b.sellSignal || b.buySignal))
  const wins = completed.filter((row) => row.outcome === "Win")
  const losses = completed.filter((row) => row.outcome === "Loss")
  const flats = completed.filter((row) => row.outcome === "Flat")
  const returns = completed.map((row) => row.returnPct as number)
  const benchmarkReturns = completed.map((row) => row.vnindexReturnPct).filter((value): value is number => value != null)
  const alphas = completed.map((row) => row.alphaPct).filter((value): value is number => value != null)
  const avgWin = avg(wins.map((row) => row.returnPct as number))
  const avgLoss = avg(losses.map((row) => row.returnPct as number))
  let strategyIndex = 100
  let vnindexIndex = 100
  const curve: PerformancePoint[] = [{ label: "Start", strategy: 100, vnindex: 100 }]
  completed.forEach((row, index) => {
    strategyIndex *= 1 + (row.returnPct as number) / 100
    if (row.vnindexReturnPct != null) vnindexIndex *= 1 + row.vnindexReturnPct / 100
    curve.push({
      label: row.ticker || `#${index + 1}`,
      strategy: strategyIndex,
      vnindex: row.vnindexReturnPct == null ? null : vnindexIndex,
    })
  })
  return {
    total: rows.length,
    open: rows.filter((row) => row.status === "Open").length,
    closed: completed.length,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    winRate: completed.length ? wins.length / completed.length * 100 : null,
    avgReturn: avg(returns),
    avgVnindexReturn: avg(benchmarkReturns),
    avgAlpha: avg(alphas),
    alphaWinRate: alphas.length ? alphas.filter((value) => value > 0).length / alphas.length * 100 : null,
    avgWin,
    avgLoss,
    payoff: avgWin != null && avgLoss != null && avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : null,
    bestReturn: returns.length ? Math.max(...returns) : null,
    worstReturn: returns.length ? Math.min(...returns) : null,
    curve,
  }
}
