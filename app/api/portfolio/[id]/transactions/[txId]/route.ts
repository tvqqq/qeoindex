import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const VALID_ACTIONS = ["buy", "sell", "dividend_cash", "dividend_stock", "rights"] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function err(msg: string, status = 500) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE })
}

function validateUUID(id: string) {
  return UUID_RE.test(id) ? id : null
}

/** PATCH /api/portfolio/[id]/transactions/[txId] — update a transaction */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; txId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id, txId } = await params
  const portfolioId = validateUUID(id)
  const transactionId = validateUUID(txId)
  if (!portfolioId || !transactionId) return err("ID không hợp lệ.", 400)

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return err("Request body không hợp lệ.", 400)

  const updates: Record<string, unknown> = {}

  if (body.action !== undefined) {
    const action = String(body.action)
    if (!VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
      return err("Loại giao dịch không hợp lệ.", 400)
    }
    updates.action = action
  }

  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) return err("Khối lượng phải lớn hơn 0.", 400)
    updates.quantity = quantity
  }

  if (body.price !== undefined) {
    const price = Number(body.price)
    if (!Number.isFinite(price) || price < 0) return err("Giá không hợp lệ.", 400)
    updates.price = price
  }

  if (body.fee !== undefined) {
    const fee = Number(body.fee)
    if (!Number.isFinite(fee) || fee < 0) return err("Phí không hợp lệ.", 400)
    updates.fee = fee
  }

  if (body.transaction_date !== undefined) {
    const d = String(body.transaction_date)
    if (!DATE_RE.test(d)) return err("Ngày giao dịch không hợp lệ (YYYY-MM-DD).", 400)
    updates.transaction_date = d
  }

  if (body.note !== undefined) {
    updates.note = body.note ? String(body.note).slice(0, 2000) : null
  }

  if (body.tags !== undefined) {
    updates.tags = Array.isArray(body.tags)
      ? (body.tags as unknown[]).map((t) => String(t).slice(0, 50)).slice(0, 10)
      : []
  }

  if (body.target_price !== undefined) {
    const tp = body.target_price !== null ? Number(body.target_price) : null
    updates.target_price = tp !== null && Number.isFinite(tp) ? tp : null
  }

  if (body.stop_loss !== undefined) {
    const sl = body.stop_loss !== null ? Number(body.stop_loss) : null
    updates.stop_loss = sl !== null && Number.isFinite(sl) ? sl : null
  }

  if (Object.keys(updates).length === 0) {
    return err("Không có thông tin cần cập nhật.", 400)
  }

  const { data, error } = await auth.context.supabase
    .from("portfolio_transactions")
    .update(updates)
    .eq("id", transactionId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", auth.context.user.id)
    .select(
      "id,portfolio_id,ticker,action,quantity,price,fee,transaction_date,note,tags,target_price,stop_loss,created_at,updated_at",
    )
    .single()

  if (error || !data) {
    console.error("[Portfolio Transaction] PATCH failed", error)
    return err("Failed to update transaction.")
  }

  return NextResponse.json({ ok: true, transaction: data }, { headers: NO_STORE })
}

/** DELETE /api/portfolio/[id]/transactions/[txId] — delete a transaction */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; txId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { id, txId } = await params
  const portfolioId = validateUUID(id)
  const transactionId = validateUUID(txId)
  if (!portfolioId || !transactionId) return err("ID không hợp lệ.", 400)

  const { error } = await auth.context.supabase
    .from("portfolio_transactions")
    .delete()
    .eq("id", transactionId)
    .eq("portfolio_id", portfolioId)
    .eq("user_id", auth.context.user.id)

  if (error) {
    console.error("[Portfolio Transaction] DELETE failed", error)
    return err("Failed to delete transaction.")
  }

  return NextResponse.json({ ok: true, id: transactionId }, { headers: NO_STORE })
}
