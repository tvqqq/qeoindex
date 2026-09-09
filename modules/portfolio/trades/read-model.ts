import { deriveTradeFillHistory, type TradeFillHistoryEntry } from "./fill-history.ts"
import { deriveTradeCloseReview, type TradeCloseReview } from "./review.ts"
import type {
  PersistedTradeMode,
  TradeGroupingStatus,
  TradeOrigin,
  TradeStatus,
} from "./types.ts"

type TradeReadRow = {
  id: string
  portfolio_id: string
  user_id: string
  ticker: string
  mode: PersistedTradeMode
  status: TradeStatus
  origin?: TradeOrigin
  grouping_status?: TradeGroupingStatus
  scorecard_eligible?: boolean
  legacy_opened_on?: string | null
  legacy_closed_on?: string | null
  legacy_source_transaction_count?: number | null
  money_management_plan_id?: string | null
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
  created_at?: string
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

type StopExitFillLinkReadRow = {
  stop_event_id: string
  transaction_id: string
  trade_id: string
  ticker: string
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

export type TradeStopEventReadModel = StopReadRow & {
  linkedExitFills: FillReadRow[]
}

export type TradeReadModel = {
  trade: TradeReadRow
  fills: FillReadRow[]
  fillHistory: TradeFillHistoryEntry[]
  stopEvents: TradeStopEventReadModel[]
  journalEntries: JournalReadRow[]
  moneyManagementPlanId: string | null
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
  closeReview: TradeCloseReview
  completeness: {
    tradeGroupingState: TradeGroupingStatus
    modeState: "known" | "unknown"
    scorecardState: "eligible" | "ineligible"
    stopState: "known" | "unknown"
    initialRiskState: "available" | "partial" | "unknown"
    journalState: "available" | "unavailable"
    moneyManagementPlanState: "available" | "unknown"
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

function compareFills(a: FillReadRow, b: FillReadRow): number {
  const sessionDiff = a.transaction_date.localeCompare(b.transaction_date)
  if (sessionDiff !== 0) return sessionDiff
  const createdDiff = timestampMs(a.created_at) - timestampMs(b.created_at)
  if (createdDiff !== 0) return createdDiff
  return a.id.localeCompare(b.id)
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
  stopExitFillLinks = [],
  journalEntries,
}: {
  trade: TradeReadRow
  fills: FillReadRow[]
  stopEvents: StopReadRow[]
  stopExitFillLinks?: StopExitFillLinkReadRow[]
  journalEntries: JournalReadRow[]
}): TradeReadModel {
  const groupedFills = fills.filter(
    (fill) => fill.trade_id === trade.id && fill.ticker === trade.ticker,
  )
  const fillHistory = deriveTradeFillHistory(groupedFills, trade.ticker)
  const fillById = new Map(
    groupedFills
      .filter((fill) => fill.action === "sell")
      .map((fill) => [fill.id, fill] as const),
  )
  const scopedStopExitFillLinks = stopExitFillLinks.filter(
    (link) => link.trade_id === trade.id && link.ticker === trade.ticker,
  )
  const chronologicalStops: TradeStopEventReadModel[] = [...stopEvents]
    .sort((a, b) => {
      const effectiveDiff = timestampMs(a.effective_at) - timestampMs(b.effective_at)
      if (effectiveDiff !== 0) return effectiveDiff
      const createdDiff = timestampMs(a.created_at) - timestampMs(b.created_at)
      if (createdDiff !== 0) return createdDiff
      return a.id.localeCompare(b.id)
    })
    .map((stop) => ({
      ...stop,
      linkedExitFills: scopedStopExitFillLinks
        .filter((link) => link.stop_event_id === stop.id)
        .map((link) => fillById.get(link.transaction_id) ?? null)
        .filter((fill): fill is FillReadRow => fill != null)
        .sort(compareFills),
    }))
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
  const moneyManagementPlanId = trade.money_management_plan_id ?? null
  const closeReview = deriveTradeCloseReview({
    status: trade.status,
    ticker: trade.ticker,
    fills: groupedFills,
    initialRiskAmountVnd: trade.initial_risk_amount ?? null,
  })

  return {
    trade,
    fills: groupedFills,
    fillHistory,
    stopEvents: chronologicalStops,
    journalEntries: chronologicalJournal,
    moneyManagementPlanId,
    latestStop,
    initialRiskSnapshot: {
      accountEquity: trade.initial_account_equity ?? null,
      riskPercent: trade.initial_risk_percent ?? null,
      riskAmount: trade.initial_risk_amount ?? null,
      riskAmountPerShare: trade.initial_risk_amount_per_share ?? null,
      tradeSize: trade.planned_trade_size ?? null,
    },
    closeReview,
    completeness: {
      tradeGroupingState: trade.grouping_status ?? "native",
      modeState: trade.mode === "unknown" ? "unknown" : "known",
      scorecardState: trade.scorecard_eligible === false ? "ineligible" : "eligible",
      stopState: latestStop ? "known" : "unknown",
      initialRiskState: initialRiskState(trade),
      journalState: chronologicalJournal.length > 0 ? "available" : "unavailable",
      moneyManagementPlanState: moneyManagementPlanId ? "available" : "unknown",
    },
  }
}
