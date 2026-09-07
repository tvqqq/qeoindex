import "server-only"

import { type ServerAuthContext } from "@/modules/auth/server"
import { buildTradeReadModel } from "./read-model.ts"
import {
  TradeDomainError,
  assertFrozenTradeFieldsUnchanged,
  assertTradeTransition,
  normalizeJournalEntryInput,
  normalizeStopEventInput,
  normalizeTradeCreateInput,
} from "./validation.ts"
import { type TradeStatus } from "./types.ts"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const TRADE_SELECT = "id,portfolio_id,user_id,ticker,mode,status,trade_type,timeframe,system_tags,setup_tags,planned_entry,initial_stop_loss_exit,initial_account_equity,initial_risk_percent,initial_risk_amount,initial_risk_amount_per_share,planned_trade_size,planned_position_value,estimated_commission,slippage_allowance,opened_at,closed_at,pre_trade_plan,thesis_summary,final_review,lesson_learned,created_at,updated_at" as const

const FILL_SELECT = "id,portfolio_id,user_id,trade_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,created_at,updated_at" as const

const STOP_SELECT = "id,trade_id,portfolio_id,user_id,ticker,stop_type,price,quantity_covered,signal,reason,effective_at,created_at" as const

const JOURNAL_SELECT = "id,trade_id,portfolio_id,user_id,ticker,phase,note,emotion_tags,behavior_tags,adherence_status,override_reason,occurred_at,created_at,updated_at" as const

const PLAN_FIELDS = [
  "ticker",
  "mode",
  "trade_type",
  "timeframe",
  "system_tags",
  "setup_tags",
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
  "pre_trade_plan",
  "thesis_summary",
] as const

const FILL_ACTIONS = new Set(["buy", "sell", "rights", "dividend_stock"])

type TradeRow = Record<string, unknown> & {
  id: string
  portfolio_id: string
  user_id: string
  ticker: string
  mode: "live" | "paper"
  status: TradeStatus
  trade_type: "day" | "position" | null
  timeframe: string | null
  system_tags: string[]
  setup_tags: string[]
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
  opened_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
}

type FillRow = Record<string, unknown> & {
  id: string
  portfolio_id: string
  user_id: string
  trade_id: string | null
  ticker: string
  action: string
  quantity: number
  price: number
  fee: number
  transaction_date: string
}

function requireUuid(value: string, label: string) {
  if (!UUID_RE.test(value)) throw new TradeDomainError("INVALID_ID", `${label} is invalid`)
  return value
}

function dbFailure(operation: string, error: unknown): never {
  const detail = String((error as { message?: unknown } | null)?.message ?? "unknown database error")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
  console.error(`[QeoIndex Trade] ${operation} failed: ${detail}`)
  throw new Error(`Trade persistence failed during ${operation}`)
}

function boundedText(value: unknown, label: string, max: number): string | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  if (text.length > max) throw new TradeDomainError("TEXT_TOO_LONG", `${label} must be ${max} characters or fewer`)
  return text
}

function normalizedTimestamp(value: unknown, label: string): string {
  const date = value == null || value === "" ? new Date() : new Date(String(value))
  if (Number.isNaN(date.getTime())) throw new TradeDomainError("INVALID_TIMESTAMP", `${label} is invalid`)
  return date.toISOString()
}

function asInputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TradeDomainError("INVALID_INPUT", "Trade input must be an object")
  }
  return input as Record<string, unknown>
}

async function ensurePortfolioOwned(context: ServerAuthContext, portfolioId: string) {
  requireUuid(portfolioId, "Portfolio ID")
  const result = await context.supabase
    .from("portfolios")
    .select("id,user_id")
    .eq("id", portfolioId)
    .eq("user_id", context.user.id)
    .maybeSingle()
  if (result.error) dbFailure("load-portfolio", result.error)
  if (!result.data) throw new TradeDomainError("NOT_FOUND", "Portfolio was not found")
  return result.data
}

async function loadOwnedTrade(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
): Promise<TradeRow> {
  requireUuid(portfolioId, "Portfolio ID")
  requireUuid(tradeId, "Trade ID")
  const result = await context.supabase
    .from("portfolio_trades")
    .select(TRADE_SELECT)
    .eq("id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .maybeSingle()
  if (result.error) dbFailure("load-trade", result.error)
  if (!result.data) throw new TradeDomainError("NOT_FOUND", "Trade was not found")
  return result.data as TradeRow
}

function normalizedPlanPatch(trade: TradeRow, input: unknown) {
  const body = asInputRecord(input)
  if (body.status !== undefined) {
    throw new TradeDomainError("STATUS_REQUIRES_TRANSITION", "Trade status must be changed through transitionTrade")
  }

  const candidate = normalizeTradeCreateInput({
    ticker: body.ticker ?? trade.ticker,
    mode: body.mode ?? trade.mode,
    trade_type: body.trade_type !== undefined ? body.trade_type : trade.trade_type,
    timeframe: body.timeframe !== undefined ? body.timeframe : trade.timeframe,
    system_tags: body.system_tags !== undefined ? body.system_tags : trade.system_tags,
    setup_tags: body.setup_tags !== undefined ? body.setup_tags : trade.setup_tags,
    planned_entry: body.planned_entry !== undefined ? body.planned_entry : trade.planned_entry,
    initial_stop_loss_exit:
      body.initial_stop_loss_exit !== undefined ? body.initial_stop_loss_exit : trade.initial_stop_loss_exit,
    initial_account_equity:
      body.initial_account_equity !== undefined ? body.initial_account_equity : trade.initial_account_equity,
    initial_risk_percent:
      body.initial_risk_percent !== undefined ? body.initial_risk_percent : trade.initial_risk_percent,
    initial_risk_amount:
      body.initial_risk_amount !== undefined ? body.initial_risk_amount : trade.initial_risk_amount,
    initial_risk_amount_per_share:
      body.initial_risk_amount_per_share !== undefined
        ? body.initial_risk_amount_per_share
        : trade.initial_risk_amount_per_share,
    planned_trade_size:
      body.planned_trade_size !== undefined ? body.planned_trade_size : trade.planned_trade_size,
    planned_position_value:
      body.planned_position_value !== undefined ? body.planned_position_value : trade.planned_position_value,
    estimated_commission:
      body.estimated_commission !== undefined ? body.estimated_commission : trade.estimated_commission,
    slippage_allowance:
      body.slippage_allowance !== undefined ? body.slippage_allowance : trade.slippage_allowance,
    pre_trade_plan: body.pre_trade_plan,
    thesis_summary: body.thesis_summary,
  })

  const patch: Record<string, unknown> = {}
  for (const field of PLAN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = candidate[field]
  }
  return patch
}

export async function createTrade(
  context: ServerAuthContext,
  portfolioId: string,
  input: unknown,
) {
  await ensurePortfolioOwned(context, portfolioId)
  const trade = normalizeTradeCreateInput(input)
  const result = await context.supabase
    .from("portfolio_trades")
    .insert({
      portfolio_id: portfolioId,
      user_id: context.user.id,
      ...trade,
    })
    .select(TRADE_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("create-trade", result.error)
  return result.data as TradeRow
}

export async function updatePlannedTrade(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  input: unknown,
) {
  const trade = await loadOwnedTrade(context, portfolioId, tradeId)
  const patch = normalizedPlanPatch(trade, input)
  assertFrozenTradeFieldsUnchanged(trade, patch)
  if (trade.status !== "planned") {
    throw new TradeDomainError("TRADE_NOT_PLANNED", "Only a planned Trade may edit its plan")
  }
  if (Object.keys(patch).length === 0) return trade

  const result = await context.supabase
    .from("portfolio_trades")
    .update(patch)
    .eq("id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .select(TRADE_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("update-planned-trade", result.error)
  return result.data as TradeRow
}

export async function transitionTrade(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  targetStatus: TradeStatus,
  input: unknown = {},
) {
  const trade = await loadOwnedTrade(context, portfolioId, tradeId)
  assertTradeTransition(trade.status, targetStatus)
  const body = asInputRecord(input)
  const planPatch = normalizedPlanPatch(trade, body)
  assertFrozenTradeFieldsUnchanged(trade, planPatch)

  const updates: Record<string, unknown> = { ...planPatch, status: targetStatus }
  if (targetStatus === "open") {
    updates.opened_at = normalizedTimestamp(body.opened_at, "opened_at")
    updates.closed_at = null
  } else if (targetStatus === "partially_closed") {
    updates.opened_at = trade.opened_at
    updates.closed_at = null
  } else if (targetStatus === "closed") {
    updates.opened_at = trade.opened_at
    updates.closed_at = normalizedTimestamp(body.closed_at, "closed_at")
    if (new Date(String(updates.closed_at)).getTime() < new Date(String(trade.opened_at)).getTime()) {
      throw new TradeDomainError("INVALID_TIMESTAMP", "closed_at cannot be before opened_at")
    }
    if (body.final_review !== undefined) updates.final_review = boundedText(body.final_review, "final_review", 10_000)
    if (body.lesson_learned !== undefined) updates.lesson_learned = boundedText(body.lesson_learned, "lesson_learned", 10_000)
  } else if (targetStatus === "cancelled") {
    updates.opened_at = null
    updates.closed_at = null
  }

  const result = await context.supabase
    .from("portfolio_trades")
    .update(updates)
    .eq("id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .select(TRADE_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("transition-trade", result.error)
  return result.data as TradeRow
}

export async function getTrade(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
) {
  return loadOwnedTrade(context, portfolioId, tradeId)
}

export async function listTrades(context: ServerAuthContext, portfolioId: string) {
  await ensurePortfolioOwned(context, portfolioId)
  const result = await context.supabase
    .from("portfolio_trades")
    .select(TRADE_SELECT)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("created_at", { ascending: false })
  if (result.error) dbFailure("list-trades", result.error)
  return (result.data ?? []) as TradeRow[]
}

async function loadOwnedFill(
  context: ServerAuthContext,
  portfolioId: string,
  transactionId: string,
): Promise<FillRow> {
  requireUuid(transactionId, "Transaction ID")
  const result = await context.supabase
    .from("portfolio_transactions")
    .select(FILL_SELECT)
    .eq("id", transactionId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .maybeSingle()
  if (result.error) dbFailure("load-fill", result.error)
  if (!result.data) throw new TradeDomainError("NOT_FOUND", "Transaction was not found")
  return result.data as FillRow
}

export async function attachFillToTrade(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  transactionId: string,
) {
  const trade = await loadOwnedTrade(context, portfolioId, tradeId)
  if (trade.status === "cancelled") {
    throw new TradeDomainError("TRADE_CANCELLED", "A cancelled Trade cannot receive fills")
  }
  const transaction = await loadOwnedFill(context, portfolioId, transactionId)
  if (transaction.ticker !== trade.ticker) {
    throw new TradeDomainError("TICKER_MISMATCH", "Transaction ticker does not match Trade ticker")
  }
  if (!FILL_ACTIONS.has(transaction.action)) {
    throw new TradeDomainError("INVALID_FILL_ACTION", `${transaction.action} is not a Trade fill action`)
  }
  if (transaction.trade_id && transaction.trade_id !== tradeId) {
    throw new TradeDomainError("FILL_ALREADY_LINKED", "Transaction is already attached to another Trade")
  }
  if (transaction.trade_id === tradeId) return transaction

  const result = await context.supabase
    .from("portfolio_transactions")
    .update({ trade_id: tradeId })
    .eq("id", transactionId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .eq("ticker", trade.ticker)
    .select(FILL_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("attach-fill", result.error)
  return result.data as FillRow
}

export async function detachFillFromTrade(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  transactionId: string,
) {
  await loadOwnedTrade(context, portfolioId, tradeId)
  const transaction = await loadOwnedFill(context, portfolioId, transactionId)
  if (transaction.trade_id !== tradeId) {
    throw new TradeDomainError("FILL_NOT_LINKED", "Transaction is not attached to this Trade")
  }

  const result = await context.supabase
    .from("portfolio_transactions")
    .update({ trade_id: null })
    .eq("id", transactionId)
    .eq("trade_id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .select(FILL_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("detach-fill", result.error)
  return result.data as FillRow
}

export async function addStopEvent(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  input: unknown,
) {
  const trade = await loadOwnedTrade(context, portfolioId, tradeId)
  if (trade.status === "planned" || trade.status === "cancelled") {
    throw new TradeDomainError("TRADE_NOT_OPENED", "Stop history requires an opened Trade")
  }
  const stop = normalizeStopEventInput(input)
  const result = await context.supabase
    .from("portfolio_trade_stop_events")
    .insert({
      trade_id: tradeId,
      portfolio_id: portfolioId,
      user_id: context.user.id,
      ticker: trade.ticker,
      ...stop,
    })
    .select(STOP_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("add-stop-event", result.error)
  return result.data
}

export async function listStopEvents(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
) {
  await loadOwnedTrade(context, portfolioId, tradeId)
  const result = await context.supabase
    .from("portfolio_trade_stop_events")
    .select(STOP_SELECT)
    .eq("trade_id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("effective_at", { ascending: true })
    .order("created_at", { ascending: true })
  if (result.error) dbFailure("list-stop-events", result.error)
  return result.data ?? []
}

export async function addJournalEntry(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
  input: unknown,
) {
  const trade = await loadOwnedTrade(context, portfolioId, tradeId)
  const entry = normalizeJournalEntryInput(input)
  const result = await context.supabase
    .from("portfolio_trade_journal_entries")
    .insert({
      trade_id: tradeId,
      portfolio_id: portfolioId,
      user_id: context.user.id,
      ticker: trade.ticker,
      ...entry,
    })
    .select(JOURNAL_SELECT)
    .single()
  if (result.error || !result.data) dbFailure("add-journal-entry", result.error)
  return result.data
}

export async function listJournalEntries(
  context: ServerAuthContext,
  portfolioId: string,
  tradeId: string,
) {
  await loadOwnedTrade(context, portfolioId, tradeId)
  const result = await context.supabase
    .from("portfolio_trade_journal_entries")
    .select(JOURNAL_SELECT)
    .eq("trade_id", tradeId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("occurred_at", { ascending: true })
    .order("created_at", { ascending: true })
  if (result.error) dbFailure("list-journal-entries", result.error)
  return result.data ?? []
}

export async function readPortfolioTradeContext(
  context: ServerAuthContext,
  portfolioId: string,
) {
  const trades = await listTrades(context, portfolioId)
  const tradeIds = trades.map((trade) => trade.id)

  const allTransactions = await context.supabase
    .from("portfolio_transactions")
    .select(FILL_SELECT)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", context.user.id)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true })
  if (allTransactions.error) dbFailure("read-context-fills", allTransactions.error)

  let stops: Record<string, unknown>[] = []
  let journal: Record<string, unknown>[] = []
  if (tradeIds.length > 0) {
    const stopResult = await context.supabase
      .from("portfolio_trade_stop_events")
      .select(STOP_SELECT)
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .in("trade_id", tradeIds)
    if (stopResult.error) dbFailure("read-context-stops", stopResult.error)
    stops = (stopResult.data ?? []) as Record<string, unknown>[]

    const journalResult = await context.supabase
      .from("portfolio_trade_journal_entries")
      .select(JOURNAL_SELECT)
      .eq("portfolio_id", portfolioId)
      .eq("user_id", context.user.id)
      .in("trade_id", tradeIds)
    if (journalResult.error) dbFailure("read-context-journal", journalResult.error)
    journal = (journalResult.data ?? []) as Record<string, unknown>[]
  }

  const transactions = (allTransactions.data ?? []) as FillRow[]
  const groupedCount = transactions.filter((row) => row.trade_id != null).length
  const legacyGrouping = transactions.length === 0 || groupedCount === transactions.length
    ? "grouped"
    : groupedCount === 0
      ? "ungrouped"
      : "mixed"

  return {
    portfolioId,
    moneyManagementPlanRef: null,
    completeness: { legacyGrouping },
    trades: trades.map((trade) =>
      buildTradeReadModel({
        trade,
        fills: transactions.filter((row) => row.trade_id === trade.id),
        stopEvents: stops.filter((row) => row.trade_id === trade.id) as never[],
        journalEntries: journal.filter((row) => row.trade_id === trade.id) as never[],
      }),
    ),
  }
}

export { TRADE_SELECT, FILL_SELECT, STOP_SELECT, JOURNAL_SELECT }