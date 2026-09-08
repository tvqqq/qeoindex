import type { RawTransaction } from "../pnl.ts"
import {
  computeOpenTradeActiveRisk,
  type OpenTradeRiskInput,
  type StopRiskInput,
} from "../risk-engine/active-risk.ts"
import type { OpenTradeRiskBreakdown } from "./types.ts"

export type OpenTradeRiskRow = OpenTradeRiskInput
export type StopRiskRow = StopRiskInput

export function computeOpenTradeRiskContext({
  trades,
  fills,
  stopEvents,
}: {
  trades: OpenTradeRiskRow[]
  fills: RawTransaction[]
  stopEvents: StopRiskRow[]
}) {
  const current = computeOpenTradeActiveRisk({ trades, fills, stopEvents })
  const breakdown: OpenTradeRiskBreakdown[] = current.rows.map((row) => ({
    tradeId: row.tradeId,
    ticker: row.ticker,
    openQty: row.openQty,
    avgCostKvnd: row.avgCostKvnd,
    latestStopKvnd: row.currentStopKvnd,
    activeRiskVnd: row.activeRiskVnd,
    riskStatus: row.riskStatus,
  }))

  return {
    knownActiveRiskVnd: current.knownActiveRiskVnd,
    unknownRiskTradeCount: current.unknownRiskItemCount,
    breakdown,
  }
}
