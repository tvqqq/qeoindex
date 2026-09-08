import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import {
  linkExitFillToStopEvent,
  listStopExitFillLinks,
} from "@/modules/portfolio/trades/server"
import { TradeDomainError } from "@/modules/portfolio/trades/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

function failure(error: unknown) {
  if (error instanceof TradeDomainError) {
    const status = error.code === "NOT_FOUND"
      ? 404
      : error.code === "EXIT_FILL_ALREADY_LINKED"
        ? 409
        : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Trade Stop Exit Fills] request failed", error)
  return NextResponse.json(
    { ok: false, error: "Trade stop exit fill request failed." },
    { status: 500, headers: NO_STORE },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string; stopEventId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId, stopEventId } = await params

  try {
    const links = await listStopExitFillLinks(auth.context, id, tradeId, stopEventId)
    return NextResponse.json({ ok: true, links }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string; stopEventId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId, stopEventId } = await params
  const body = await request.json().catch(() => null) as { transaction_id?: unknown } | null
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Request body không hợp lệ." },
      { status: 400, headers: NO_STORE },
    )
  }
  const transactionId = typeof body.transaction_id === "string" ? body.transaction_id : ""

  try {
    const link = await linkExitFillToStopEvent(
      auth.context,
      id,
      tradeId,
      stopEventId,
      transactionId,
    )
    return NextResponse.json({ ok: true, link }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
