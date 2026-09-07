import {
  FROZEN_TRADE_FIELDS,
  TRADE_ADHERENCE_STATUSES,
  TRADE_JOURNAL_PHASES,
  TRADE_MODES,
  TRADE_STATUSES,
  TRADE_STOP_TYPES,
  TRADE_TYPES,
  type FrozenTradeSnapshot,
  type TradeCreateInput,
  type TradeJournalEntryInput,
  type TradePlanReferenceSnapshot,
  type TradeStatus,
  type TradeStopEventInput,
} from "./types.ts"

const TICKER_RE = /^[A-Z0-9]{2,12}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_TAGS = 20
const MAX_TAG_LENGTH = 50

const TRANSITIONS: Readonly<Record<TradeStatus, readonly TradeStatus[]>> = {
  planned: ["open", "cancelled"],
  open: ["partially_closed", "closed"],
  partially_closed: ["closed"],
  closed: [],
  cancelled: [],
}

export class TradeDomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "TradeDomainError"
    this.code = code
  }
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TradeDomainError("INVALID_INPUT", "Trade input must be an object")
  }
  return input as Record<string, unknown>
}

function requiredTicker(value: unknown): string {
  const ticker = String(value ?? "").trim().toUpperCase()
  if (!TICKER_RE.test(ticker)) throw new TradeDomainError("INVALID_TICKER", "Ticker is invalid")
  return ticker
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || value === "") return null
  const uuid = String(value).trim()
  if (!UUID_RE.test(uuid)) throw new TradeDomainError("INVALID_ID", `${label} is invalid`)
  return uuid
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
  fallback?: T[number],
): T[number] {
  const normalized = value == null || value === "" ? fallback : String(value)
  if (normalized == null || !allowed.includes(normalized as T[number])) {
    throw new TradeDomainError("INVALID_ENUM", `${label} is invalid`)
  }
  return normalized as T[number]
}

function optionalEnum<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] | null {
  if (value == null || value === "") return null
  return enumValue(value, allowed, label)
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value == null) return null
  const text = String(value).trim()
  if (!text) return null
  if (text.length > maxLength) {
    throw new TradeDomainError("TEXT_TOO_LONG", `${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? "").trim()
  if (!text) throw new TradeDomainError("REQUIRED_TEXT", `${label} is required`)
  if (text.length > maxLength) {
    throw new TradeDomainError("TEXT_TOO_LONG", `${label} must be ${maxLength} characters or fewer`)
  }
  return text
}

function optionalNumber(
  value: unknown,
  label: string,
  rule: "positive" | "nonnegative" | "percent",
): number | null {
  if (value == null || value === "") return null
  const number = Number(value)
  if (!Number.isFinite(number)) throw new TradeDomainError("INVALID_NUMBER", `${label} must be a finite number`)

  if (rule === "positive" && number <= 0) {
    throw new TradeDomainError("INVALID_NUMBER", `${label} must be greater than 0`)
  }
  if (rule === "nonnegative" && number < 0) {
    throw new TradeDomainError("INVALID_NUMBER", `${label} must be 0 or greater`)
  }
  if (rule === "percent" && (number < 0 || number > 100)) {
    throw new TradeDomainError("INVALID_NUMBER", `${label} must be between 0 and 100`)
  }
  return number
}

function requiredPositiveNumber(value: unknown, label: string): number {
  const number = optionalNumber(value, label, "positive")
  if (number == null) throw new TradeDomainError("REQUIRED_NUMBER", `${label} is required`)
  return number
}

function normalizeTags(value: unknown, label: string): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new TradeDomainError("INVALID_TAGS", `${label} must be an array`)
  if (value.length > MAX_TAGS) throw new TradeDomainError("INVALID_TAGS", `${label} may contain at most ${MAX_TAGS} items`)

  const result: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const tag = String(raw ?? "").trim()
    if (!tag) continue
    if (tag.length > MAX_TAG_LENGTH) {
      throw new TradeDomainError("INVALID_TAGS", `${label} items must be ${MAX_TAG_LENGTH} characters or fewer`)
    }
    if (!seen.has(tag)) {
      seen.add(tag)
      result.push(tag)
    }
  }
  return result
}

function normalizedTimestamp(value: unknown, fallbackNow = true): string {
  if (value == null || value === "") {
    if (fallbackNow) return new Date().toISOString()
    throw new TradeDomainError("INVALID_TIMESTAMP", "timestamp is required")
  }
  const timestamp = new Date(String(value))
  if (Number.isNaN(timestamp.getTime())) {
    throw new TradeDomainError("INVALID_TIMESTAMP", "timestamp is invalid")
  }
  return timestamp.toISOString()
}

export function canTransitionTrade(from: TradeStatus, to: TradeStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTradeTransition(from: TradeStatus, to: TradeStatus): void {
  if (!TRADE_STATUSES.includes(from) || !TRADE_STATUSES.includes(to) || !canTransitionTrade(from, to)) {
    throw new TradeDomainError(
      "INVALID_TRANSITION",
      `Cannot transition Trade from ${String(from)} to ${String(to)}`,
    )
  }
}

export function normalizeTradeCreateInput(input: unknown): TradeCreateInput {
  const body = asRecord(input)
  return {
    ticker: requiredTicker(body.ticker),
    mode: enumValue(body.mode, TRADE_MODES, "mode", "live"),
    status: "planned",
    trade_type: optionalEnum(body.trade_type, TRADE_TYPES, "trade_type"),
    timeframe: optionalText(body.timeframe, "timeframe", 40),
    system_tags: normalizeTags(body.system_tags, "system_tags"),
    setup_tags: normalizeTags(body.setup_tags, "setup_tags"),
    money_management_plan_id: optionalUuid(body.money_management_plan_id, "money_management_plan_id"),
    planned_entry: optionalNumber(body.planned_entry, "planned_entry", "positive"),
    initial_stop_loss_exit: optionalNumber(
      body.initial_stop_loss_exit,
      "initial_stop_loss_exit",
      "positive",
    ),
    initial_account_equity: optionalNumber(
      body.initial_account_equity,
      "initial_account_equity",
      "nonnegative",
    ),
    initial_risk_percent: optionalNumber(
      body.initial_risk_percent,
      "initial_risk_percent",
      "percent",
    ),
    initial_risk_amount: optionalNumber(
      body.initial_risk_amount,
      "initial_risk_amount",
      "nonnegative",
    ),
    initial_risk_amount_per_share: optionalNumber(
      body.initial_risk_amount_per_share,
      "initial_risk_amount_per_share",
      "positive",
    ),
    planned_trade_size: optionalNumber(body.planned_trade_size, "planned_trade_size", "positive"),
    planned_position_value: optionalNumber(
      body.planned_position_value,
      "planned_position_value",
      "nonnegative",
    ),
    estimated_commission: optionalNumber(
      body.estimated_commission,
      "estimated_commission",
      "nonnegative",
    ),
    slippage_allowance: optionalNumber(
      body.slippage_allowance,
      "slippage_allowance",
      "nonnegative",
    ),
    pre_trade_plan: optionalText(body.pre_trade_plan, "pre_trade_plan", 10_000),
    thesis_summary: optionalText(body.thesis_summary, "thesis_summary", 10_000),
  }
}

export function assertFrozenTradeFieldsUnchanged(
  existing: FrozenTradeSnapshot,
  patch: Partial<Record<(typeof FROZEN_TRADE_FIELDS)[number], number | null>>,
): void {
  if (existing.status === "planned") return

  for (const field of FROZEN_TRADE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue
    if (!Object.is(existing[field], patch[field])) {
      throw new TradeDomainError(
        "FROZEN_INITIAL_SNAPSHOT",
        `${field} is frozen after Trade opens`,
      )
    }
  }
}

export function assertMoneyManagementPlanReferenceUnchanged(
  existing: TradePlanReferenceSnapshot,
  patch: { money_management_plan_id?: string | null },
): void {
  if (existing.status === "planned") return
  if (!Object.prototype.hasOwnProperty.call(patch, "money_management_plan_id")) return
  if (Object.is(existing.money_management_plan_id, patch.money_management_plan_id)) return

  throw new TradeDomainError(
    "FROZEN_INITIAL_SNAPSHOT",
    "money_management_plan_id is frozen after Trade opens",
  )
}

export function normalizeStopEventInput(input: unknown): TradeStopEventInput {
  const body = asRecord(input)
  return {
    stop_type: enumValue(body.stop_type, TRADE_STOP_TYPES, "stop_type"),
    price: requiredPositiveNumber(body.price, "price"),
    quantity_covered: optionalNumber(body.quantity_covered, "quantity_covered", "positive"),
    signal: optionalText(body.signal, "signal", 2_000),
    reason: optionalText(body.reason, "reason", 2_000),
    effective_at: normalizedTimestamp(body.effective_at),
  }
}

export function normalizeJournalEntryInput(input: unknown): TradeJournalEntryInput {
  const body = asRecord(input)
  return {
    phase: enumValue(body.phase, TRADE_JOURNAL_PHASES, "phase"),
    note: requiredText(body.note, "note", 5_000),
    emotion_tags: normalizeTags(body.emotion_tags, "emotion_tags"),
    behavior_tags: normalizeTags(body.behavior_tags, "behavior_tags"),
    adherence_status: optionalEnum(
      body.adherence_status,
      TRADE_ADHERENCE_STATUSES,
      "adherence_status",
    ),
    override_reason: optionalText(body.override_reason, "override_reason", 2_000),
    occurred_at: normalizedTimestamp(body.occurred_at),
  }
}
