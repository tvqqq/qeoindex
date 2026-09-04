import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const TICKER_RE = /^[A-Z0-9]{2,12}$/
const VALID_ACTIONS = ["buy", "sell", "dividend_cash", "dividend_stock", "rights"] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function err(msg: string, status = 500) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE })
}

function validatePortfolioId(id: string) {
  return UUID_RE.test(id) ? id : null
}

function parseNullableNumber(value: unknown) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null
}

function canonicalOrLegacy(body: Record<string, unknown>, canonicalKey: string, legacyKey: string) {
  return body[canonicalKey] !== undefined ? body[canonicalKey] : body[legacyKey]
}

const SELECT_FIELDS =
  "id,portfolio_id,ticker,action,quantity,price,fee,fee_rate,transaction_date,note,tags,setup_tags,mistake_tags,target_price_1,target_price_2,target_price_3,stop_loss_1,stop_loss_2,stop_loss_3,created_at,updated_at"

/** GET /api/portfolio/[id]/transactions — list transactions for a portfolio */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = validatePortfolioId(id)
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  const { data, error } = await auth.context.supabase
    .from("portfolio_transactions")
    .select(SELECT_FIELDS)
    .eq("user_id", auth.context.user.id)
    .eq("portfolio_id", portfolioId)
    .order("transaction_date", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    console.error("[Portfolio Transactions] GET failed", error)
    return err("Failed to load transactions.")
  }

  return NextResponse.json({ ok: true, transactions: data ?? [] }, { headers: NO_STORE })
}

/** POST /api/portfolio/[id]/transactions — add a new transaction or batch of transactions */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = validatePortfolioId(id)
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  const { data: portfolio } = await auth.context.supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .maybeSingle()

  if (!portfolio) return err("Danh mục không tồn tại.", 404)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return err("Request body không hợp lệ.", 400)

  if (Array.isArray(body.batch)) {
    const items = body.batch as Record<string, unknown>[]
    if (items.length === 0 || items.length > 100) {
      return err("Danh sách nhập hàng loạt từ 1 đến 100 giao dịch.", 400)
    }

    const rowsToInsert = []
    for (const item of items) {
      const ticker = String(item.ticker ?? "").trim().toUpperCase()
      if (!TICKER_RE.test(ticker)) return err(`Mã ${ticker} không hợp lệ.`, 400)
      const action = String(item.action ?? "buy")
      if (!VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
        return err(`Loại giao dịch ${action} không hợp lệ.`, 400)
      }
      const qty = Number(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0) return err("Khối lượng phải lớn hơn 0.", 400)
      const price = Number(item.price ?? 0)
      if (!Number.isFinite(price) || price < 0) return err("Giá không hợp lệ.", 400)
      const fee = Number(item.fee ?? 0)
      if (!Number.isFinite(fee) || fee < 0) return err("Phí không hợp lệ.", 400)
      const date = String(item.transaction_date ?? "")
      if (!DATE_RE.test(date)) return err("Ngày giao dịch không hợp lệ.", 400)

      rowsToInsert.push({
        portfolio_id: portfolioId,
        user_id: auth.context.user.id,
        ticker,
        action,
        quantity: qty,
        price,
        fee,
        transaction_date: date,
        note: item.note ? String(item.note).slice(0, 2000) : null,
        tags: Array.isArray(item.tags) ? (item.tags as string[]).slice(0, 10) : [],
        setup_tags: Array.isArray(item.setup_tags) ? (item.setup_tags as string[]).slice(0, 10) : [],
        mistake_tags: Array.isArray(item.mistake_tags) ? (item.mistake_tags as string[]).slice(0, 10) : [],
        target_price_1: parseNullableNumber(canonicalOrLegacy(item, "target_price_1", "target_price")),
        target_price_2: parseNullableNumber(item.target_price_2),
        target_price_3: parseNullableNumber(item.target_price_3),
        stop_loss_1: parseNullableNumber(canonicalOrLegacy(item, "stop_loss_1", "stop_loss")),
        stop_loss_2: parseNullableNumber(item.stop_loss_2),
        stop_loss_3: parseNullableNumber(item.stop_loss_3),
      })
    }

    const { data: inserted, error: batchErr } = await auth.context.supabase
      .from("portfolio_transactions")
      .insert(rowsToInsert)
      .select(SELECT_FIELDS)

    if (batchErr || !inserted) {
      console.error("[Portfolio Transactions] Batch POST failed", batchErr)
      return err("Failed to batch import transactions.")
    }

    return NextResponse.json({ ok: true, count: inserted.length, transactions: inserted }, { status: 201, headers: NO_STORE })
  }

  const ticker = String(body.ticker ?? "").trim().toUpperCase()
  if (!TICKER_RE.test(ticker)) return err("Mã cổ phiếu không hợp lệ.", 400)

  const action = String(body.action ?? "")
  if (!VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return err("Loại giao dịch không hợp lệ.", 400)
  }

  const quantity = Number(body.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return err("Khối lượng phải lớn hơn 0.", 400)
  }

  const price = Number(body.price)
  if (!Number.isFinite(price) || price < 0) {
    return err("Giá không hợp lệ.", 400)
  }

  const fee = Number(body.fee ?? 0)
  if (!Number.isFinite(fee) || fee < 0) {
    return err("Phí không hợp lệ.", 400)
  }

  const fee_rate = body.fee_rate != null ? Number(body.fee_rate) : 0.15

  const transaction_date = String(body.transaction_date ?? "")
  if (!DATE_RE.test(transaction_date)) {
    return err("Ngày giao dịch không hợp lệ (YYYY-MM-DD).", 400)
  }

  const target_price_1 = parseNullableNumber(canonicalOrLegacy(body, "target_price_1", "target_price"))
  const target_price_2 = parseNullableNumber(body.target_price_2)
  const target_price_3 = parseNullableNumber(body.target_price_3)
  const stop_loss_1 = parseNullableNumber(canonicalOrLegacy(body, "stop_loss_1", "stop_loss"))
  const stop_loss_2 = parseNullableNumber(body.stop_loss_2)
  const stop_loss_3 = parseNullableNumber(body.stop_loss_3)

  const note = body.note ? String(body.note).slice(0, 2000) : null
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).map((t) => String(t).slice(0, 50)).slice(0, 10)
    : []
  const setup_tags = Array.isArray(body.setup_tags)
    ? (body.setup_tags as unknown[]).map((t) => String(t).slice(0, 50)).slice(0, 10)
    : []
  const mistake_tags = Array.isArray(body.mistake_tags)
    ? (body.mistake_tags as unknown[]).map((t) => String(t).slice(0, 50)).slice(0, 10)
    : []

  const { data, error } = await auth.context.supabase
    .from("portfolio_transactions")
    .insert({
      portfolio_id: portfolioId,
      user_id: auth.context.user.id,
      ticker,
      action,
      quantity,
      price,
      fee,
      fee_rate,
      transaction_date,
      note,
      tags,
      setup_tags,
      mistake_tags,
      target_price_1,
      target_price_2,
      target_price_3,
      stop_loss_1,
      stop_loss_2,
      stop_loss_3,
    })
    .select(SELECT_FIELDS)
    .single()

  if (error || !data) {
    console.error("[Portfolio Transactions] POST failed", error)
    return err("Failed to add transaction.")
  }

  return NextResponse.json({ ok: true, transaction: data }, { status: 201, headers: NO_STORE })
}
