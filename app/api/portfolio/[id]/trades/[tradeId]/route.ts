import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { getTrade, transitionTrade, updatePlannedTrade } from "@/modules/portfolio/trades/server"
import type { TradeStatus } from "@/modules/portfolio/trades/types"
import { TradeDomainError } from "@/modules/portfolio/trades/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const CONFLICT_CODES = new Set([
  "INVALID_TRANSITION",
  "FROZEN_INITIAL_SNAPSHOT",
  "TRADE_NOT_PLANNED",
  "STATUS_REQUIRES_TRANSITION",
])

function failure(error: unknown) {
  if (error instanceof TradeDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : CONFLICT_CODES.has(error.code) ? 409 : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Trade] request failed", error)
  return NextResponse.json({ ok: false, error: "Trade request failed." }, { status: 500, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId } = await params
  try {
    const trade = await getTrade(auth.context, id, tradeId)
    return NextResponse.json({ ok: true, trade }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId } = await params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, error: "Request body không hợp lệ." }, { status: 400, headers: NO_STORE })

  try {
    const target = body.target_status
    const trade = target != null
      ? await transitionTrade(auth.context, id, tradeId, String(target) as TradeStatus, body)
      : await updatePlannedTrade(auth.context, id, tradeId, body)
    return NextResponse.json({ ok: true, trade }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
