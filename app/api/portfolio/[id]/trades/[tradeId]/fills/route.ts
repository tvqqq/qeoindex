import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { attachFillToTrade, detachFillFromTrade } from "@/modules/portfolio/trades/server"
import { TradeDomainError } from "@/modules/portfolio/trades/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const CONFLICT_CODES = new Set(["FILL_ALREADY_LINKED", "FILL_NOT_LINKED", "TRADE_CANCELLED", "TICKER_MISMATCH"])

function failure(error: unknown) {
  if (error instanceof TradeDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : CONFLICT_CODES.has(error.code) ? 409 : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Trade Fills] request failed", error)
  return NextResponse.json({ ok: false, error: "Trade fill request failed." }, { status: 500, headers: NO_STORE })
}

async function bodyTransactionId(request: Request) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  return body?.transaction_id ? String(body.transaction_id) : null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId } = await params
  const transactionId = await bodyTransactionId(request)
  if (!transactionId) return NextResponse.json({ ok: false, error: "transaction_id is required." }, { status: 400, headers: NO_STORE })
  try {
    const fill = await attachFillToTrade(auth.context, id, tradeId, transactionId)
    return NextResponse.json({ ok: true, fill }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId } = await params
  const transactionId = await bodyTransactionId(request)
  if (!transactionId) return NextResponse.json({ ok: false, error: "transaction_id is required." }, { status: 400, headers: NO_STORE })
  try {
    const fill = await detachFillFromTrade(auth.context, id, tradeId, transactionId)
    return NextResponse.json({ ok: true, fill }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
