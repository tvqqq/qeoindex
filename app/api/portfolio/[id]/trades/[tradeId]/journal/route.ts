import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { addJournalEntry, listJournalEntries } from "@/modules/portfolio/trades/server"
import { TradeDomainError } from "@/modules/portfolio/trades/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

function failure(error: unknown) {
  if (error instanceof TradeDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Trade Journal] request failed", error)
  return NextResponse.json({ ok: false, error: "Trade journal request failed." }, { status: 500, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId } = await params
  try {
    const journal = await listJournalEntries(auth.context, id, tradeId)
    return NextResponse.json({ ok: true, journal }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; tradeId: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id, tradeId } = await params
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: false, error: "Request body không hợp lệ." }, { status: 400, headers: NO_STORE })
  try {
    const entry = await addJournalEntry(auth.context, id, tradeId, body)
    return NextResponse.json({ ok: true, entry }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
