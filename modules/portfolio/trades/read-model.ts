import type { TradeMode, TradeStatus } from "./types.ts"

type TradeReadRow = {
  id: string
  portfolio_id: string
  user_id: string
  ticker: string
  mode: TradeMode
  status: TradeStatus
  planned_entry?: number | null
  initial_stop_loss_exit?: number | null
  initial_account_equity?: number | null
  initial_risk_percent?: number | null
  initial_risk_amount?: number | null
  initial_risk_amount_per_share?: number | null
  planned_trade_size?: number | null
  planned_position_value?: number | null
  estimated_commission?: number | null
  slippage_allowance?: number | null
  opened_at?: string | null
  closed_at?: string | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

type FillReadRow = {
  id: string
  trade_id?: string | null
  ticker: string
  action: string
  quantity: number
  price: number
  fee: number
  transaction_date: string
  [key: string]: unknown
}

type StopReadRow = {
  id: string
  stop_type: string
  price: number
  effective_at: string
  created_at: string
  [key: string]: unknown
}

type JournalReadRow = {
  id: string
  phase: string
  note: string
  emotion_tags?: string[]
  behavior_tags?: string[]
  adherence_status?: string | null
  occurred_at: string
  created_at: string
  [key: string]: unknown
}

export type TradeReadModel = {
  trade: TradeReadRow
  fills: FillReadRow[]
  stopEvents: StopReadRow[]
  journalEntries: JournalReadRow[]
  latestStop: {
    price: number
    source: string
    effectiveAt: string | null
  } | null
  initialRiskSnapshot: {
    accountEquity: number | null
    riskPercent: number | null
    riskAmount: number | null
    riskAmountPerShare: number | null
    tradeSize: number | null
  }
  completeness: {
    stopState: "known" | "unknown"
    initialRiskState: "available" | "partial" | "unknown"
    journalState: "available" | "unavailable"
  }
}

const INITIAL_RISK_KEYS = [
  "initial_account_equity",
  "initial_risk_percent",
  "initial_risk_amount",
  "initial_risk_amount_per_share",
  "planned_trade_size",
] as const

function timestampMs(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

function latestStopEvent(events: StopReadRow[]): StopReadRow | null {
  if (events.length === 0) return null
  return [...events].sort((a, b) => {
    const effectiveDiff = timestampMs(a.effective_at) - timestampMs(b.effective_at)
    if (effectiveDiff !== 0) return effectiveDiff
    const createdDiff = timestampMs(a.created_at) - timestampMs(b.created_at)
    if (createdDiff !== 0) return createdDiff
    return a.id.localeCompare(b.id)
  }).at(-1) ?? null
}

function initialRiskState(trade: TradeReadRow): "available" | "partial" | "unknown" {
  const present = INITIAL_RISK_KEYS.filter((key) => trade[key] != null).length
  if (present === 0) return "unknown"
  if (present === INITIAL_RISK_KEYS.length) return "available"
  return "partial"
}

export function buildTradeReadModel({
  trade,
  fills,
  stopEvents,
  journalEntries,
}: {
  trade: TradeReadRow
  fills: FillReadRow[]
  stopEvents: StopReadRow[]
  journalEntries: JournalReadRow[]
}): TradeReadModel {
  const groupedFills = fills.filter(
    (fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker,
  )
  const chronologicalStops = [...stopEvents].sort((a, b) => {
    const effectiveDiff = timestampMs(a.effective_at) - timestampMs(b.effective_at)
    if (effectiveDiff !== 0) return effectiveDiff
    const createdDiff = timestampMs(a.created_at) - timestampMs(b.created_at)
    if (createdDiff !== 0) return createdDiff
    return a.id.localeCompare(b.id)
  })
  const chronologicalJournal = [...journalEntries].sort((a, b) => {
    const occurredDiff = timestampMs(a.occurred_at) - timestampMs(b.occurred_at)
    if (occurredDiff !== 0) return occurredDiff
    const createdDiff = timestampMs(a.created_at) - timestampMs(b.created_at)
    if (createdDiff !== 0) return createdDiff
    return a.id.localeCompare(b.id)
  })

  const currentStopEvent = latestStopEvent(chronologicalStops)
  const latestStop = currentStopEvent
    ? {
        price: currentStopEvent.price,
        source: currentStopEvent.stop_type,
        effectiveAt: currentStopEvent.effective_at,
      }
    : trade.initial_stop_loss_exit != null
      ? {
          price: trade.initial_stop_loss_exit,
          source: "initial",
          effectiveAt: trade.opened_at ?? null,
        }
      : null

  return {
    trade,
    fills: groupedFills,
    stopEvents: chronologicalStops,
    journalEntries: chronologicalJournal,
    latestStop,
    initialRiskSnapshot: {
      accountEquity: trade.initial_account_equity ?? null,
      riskPercent: trade.initial_risk_percent ?? null,
      riskAmount: trade.initial_risk_amount ?? null,
      riskAmountPerShare: trade.initial_risk_amount_per_share ?? null,
      tradeSize: trade.planned_trade_size ?? null,
    },
    completeness: {
      stopState: latestStop ? "known" : "unknown",
      initialRiskState: initialRiskState(trade),
      journalState: chronologicalJournal.length > 0 ? "available" : "unavailable",
    },
  }
}
