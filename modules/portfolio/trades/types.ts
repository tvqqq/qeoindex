export const TRADE_MODES = ["live", "paper"] as const
export type TradeMode = (typeof TRADE_MODES)[number]

// Legacy migration may persist a Trade whose historical live/paper mode was not
// recorded. Normal user-created Trades intentionally remain constrained by
// TradeMode / TRADE_MODES above.
export type PersistedTradeMode = TradeMode | "unknown"

export const TRADE_ORIGINS = ["native", "legacy_migration"] as const
export type TradeOrigin = (typeof TRADE_ORIGINS)[number]

export const TRADE_GROUPING_STATUSES = ["native", "deterministic", "manually_reviewed"] as const
export type TradeGroupingStatus = (typeof TRADE_GROUPING_STATUSES)[number]

export const TRADE_STATUSES = [
  "planned",
  "open",
  "partially_closed",
  "closed",
  "cancelled",
] as const
export type TradeStatus = (typeof TRADE_STATUSES)[number]

export const TRADE_TYPES = ["day", "position"] as const
export type TradeType = (typeof TRADE_TYPES)[number]

export const TRADE_STOP_TYPES = [
  "initial",
  "trailing",
  "support",
  "trendline",
  "manual",
  "other",
] as const
export type TradeStopType = (typeof TRADE_STOP_TYPES)[number]

export const TRADE_JOURNAL_PHASES = ["before", "during", "after"] as const
export type TradeJournalPhase = (typeof TRADE_JOURNAL_PHASES)[number]

export const TRADE_ADHERENCE_STATUSES = [
  "followed",
  "deviated",
  "not_applicable",
  "unknown",
] as const
export type TradeAdherenceStatus = (typeof TRADE_ADHERENCE_STATUSES)[number]

export const FROZEN_TRADE_FIELDS = [
  "planned_entry",
  "initial_stop_loss_exit",
  "initial_account_equity",
  "initial_risk_percent",
  "initial_risk_amount",
  "initial_risk_amount_per_share",
  "planned_trade_size",
  "planned_position_value",
  "estimated_commission",
  "slippage_allowance",
] as const
export type FrozenTradeField = (typeof FROZEN_TRADE_FIELDS)[number]

export type TradeCreateInput = {
  ticker: string
  mode: TradeMode
  status: "planned"
  trade_type: TradeType | null
  timeframe: string | null
  system_tags: string[]
  setup_tags: string[]
  money_management_plan_id: string | null
  planned_entry: number | null
  initial_stop_loss_exit: number | null
  initial_account_equity: number | null
  initial_risk_percent: number | null
  initial_risk_amount: number | null
  initial_risk_amount_per_share: number | null
  planned_trade_size: number | null
  planned_position_value: number | null
  estimated_commission: number | null
  slippage_allowance: number | null
  pre_trade_plan: string | null
  thesis_summary: string | null
}

export type TradeStopEventInput = {
  stop_type: TradeStopType
  price: number
  quantity_covered: number | null
  signal: string | null
  reason: string | null
  effective_at: string
}

export type TradeJournalEntryInput = {
  phase: TradeJournalPhase
  note: string
  emotion_tags: string[]
  behavior_tags: string[]
  adherence_status: TradeAdherenceStatus | null
  override_reason: string | null
  occurred_at: string
}

export type FrozenTradeSnapshot = Partial<Record<FrozenTradeField, number | null>> & {
  status: TradeStatus
}

export type TradePlanReferenceSnapshot = {
  status: TradeStatus
  money_management_plan_id: string | null
}
