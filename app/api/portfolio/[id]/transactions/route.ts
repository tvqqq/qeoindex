import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"

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

  // Verify ownership via RLS
  const { data, error } = await auth.context.supabase
    .from("portfolio_transactions")
    .select(
      "id,portfolio_id,ticker,action,quantity,price,fee,transaction_date,note,tags,target_price,stop_loss,created_at,updated_at",
    )
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

/** POST /api/portfolio/[id]/transactions — add a new transaction */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id } = await params
  const portfolioId = validatePortfolioId(id)
  if (!portfolioId) return err("Portfolio ID không hợp lệ.", 400)

  // Verify portfolio belongs to user
  const { data: portfolio } = await auth.context.supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .maybeSingle()

  if (!portfolio) return err("Danh mục không tồn tại.", 404)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return err("Request body không hợp lệ.", 400)

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

  const transaction_date = String(body.transaction_date ?? "")
  if (!DATE_RE.test(transaction_date)) {
    return err("Ngày giao dịch không hợp lệ (YYYY-MM-DD).", 400)
  }

  const target_price = body.target_price != null ? Number(body.target_price) : null
  const stop_loss = body.stop_loss != null ? Number(body.stop_loss) : null
  const note = body.note ? String(body.note).slice(0, 2000) : null
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).map((t) => String(t).slice(0, 50)).slice(0, 10)
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
      transaction_date,
      note,
      tags,
      target_price: target_price !== null && Number.isFinite(target_price) ? target_price : null,
      stop_loss: stop_loss !== null && Number.isFinite(stop_loss) ? stop_loss : null,
    })
    .select(
      "id,portfolio_id,ticker,action,quantity,price,fee,transaction_date,note,tags,target_price,stop_loss,created_at,updated_at",
    )
    .single()

  if (error || !data) {
    console.error("[Portfolio Transactions] POST failed", error)
    return err("Failed to add transaction.")
  }

  return NextResponse.json({ ok: true, transaction: data }, { status: 201, headers: NO_STORE })
}
