import type { SupabaseClient } from "@supabase/supabase-js"

const TICKER = /^[A-Z0-9]{2,12}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export type CorporateActionView = {
  id: string
  ticker: string
  actionType: string
  status: string
  exDate: string | null
  recordDate: string | null
  paymentDate: string | null
  effectiveDate: string | null
  cashPerShare: number | null
  stockRatio: string | null
  rightsRatio: string | null
  subscriptionPrice: number | null
  sourceLabel: string
  sourceUrl: string | null
  sourceEventId: string
  lineageRootSourceEventId: string
  sourceComponentKey: string
  sourceUpdatedAt: string | null
  verifiedAt: string
  verificationStatus: "source_verified" | "derived_verified" | "ex_date_unknown"
}

type ReadOptions = {
  ticker: string
  from?: string | null
  to?: string | null
}

type CorporateActionRow = {
  id: string
  ticker: string
  action_type: string
  status: string
  ex_date: string | null
  ex_date_basis: "source" | "derived" | "unknown"
  record_date: string | null
  payment_date: string | null
  effective_date: string | null
  cash_per_share: number | string | null
  stock_ratio_numerator: number | string | null
  stock_ratio_denominator: number | string | null
  rights_ratio_numerator: number | string | null
  rights_ratio_denominator: number | string | null
  subscription_price: number | string | null
  source: string
  source_url: string
  source_event_id: string
  lineage_root_source_event_id: string
  source_component_key: string
  source_updated_at: string | null
  verified_at: string
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase()
  if (!TICKER.test(ticker)) throw new Error("Invalid corporate-action ticker")
  return ticker
}

function normalizeDate(value: string | null | undefined, label: string) {
  if (!value) return null
  if (!ISO_DATE.test(value)) throw new Error(`Invalid corporate-action ${label}`)
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid corporate-action ${label}`)
  }
  return value
}

function ratio(numerator: number | string | null, denominator: number | string | null) {
  if (numerator === null || denominator === null) return null
  const left = Number(numerator)
  const right = Number(denominator)
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return null
  return `${left}:${right}`
}

function numeric(value: number | string | null) {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function verificationStatus(basis: CorporateActionRow["ex_date_basis"]): CorporateActionView["verificationStatus"] {
  if (basis === "source") return "source_verified"
  if (basis === "derived") return "derived_verified"
  return "ex_date_unknown"
}

function sourceLabel(source: string) {
  return source.trim().toUpperCase()
}

function mapRow(row: CorporateActionRow): CorporateActionView {
  return {
    id: row.id,
    ticker: row.ticker,
    actionType: row.action_type,
    status: row.status,
    exDate: row.ex_date,
    recordDate: row.record_date,
    paymentDate: row.payment_date,
    effectiveDate: row.effective_date,
    cashPerShare: numeric(row.cash_per_share),
    stockRatio: ratio(row.stock_ratio_numerator, row.stock_ratio_denominator),
    rightsRatio: ratio(row.rights_ratio_numerator, row.rights_ratio_denominator),
    subscriptionPrice: numeric(row.subscription_price),
    sourceLabel: sourceLabel(row.source),
    sourceUrl: row.source_url || null,
    sourceEventId: row.source_event_id,
    lineageRootSourceEventId: row.lineage_root_source_event_id,
    sourceComponentKey: row.source_component_key,
    sourceUpdatedAt: row.source_updated_at,
    verifiedAt: row.verified_at,
    verificationStatus: verificationStatus(row.ex_date_basis),
  }
}

export async function readCorporateActions(
  supabase: SupabaseClient,
  options: ReadOptions,
): Promise<CorporateActionView[]> {
  const ticker = normalizeTicker(options.ticker)
  const from = normalizeDate(options.from, "from date")
  const to = normalizeDate(options.to, "to date")
  if (from && to && from > to) throw new Error("Invalid corporate-action date range")

  let query = supabase
    .from("corporate_actions")
    .select("id,ticker,action_type,status,ex_date,ex_date_basis,record_date,payment_date,effective_date,cash_per_share,stock_ratio_numerator,stock_ratio_denominator,rights_ratio_numerator,rights_ratio_denominator,subscription_price,source,source_url,source_event_id,lineage_root_source_event_id,source_component_key,source_updated_at,verified_at")
    .eq("ticker", ticker)

  if (from) query = query.gte("record_date", from)
  if (to) query = query.lte("record_date", to)

  const { data, error } = await query.order("record_date", { ascending: false })
  if (error) throw new Error("Unable to read corporate actions")
  return (data ?? []).map((row) => mapRow(row as CorporateActionRow))
}
