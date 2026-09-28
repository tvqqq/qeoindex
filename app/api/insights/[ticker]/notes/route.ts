import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const TICKER_RE = /^[A-Z0-9]{2,12}$/
const NOTE_LIMIT = 20_000

function err(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status, headers: NO_STORE })
}

function normalizeTicker(raw: string) {
  try {
    const ticker = decodeURIComponent(raw ?? "").trim().toUpperCase()
    return TICKER_RE.test(ticker) ? ticker : null
  } catch {
    return null
  }
}

function publicNote(row: {
  ticker: string
  content: string
  updated_at: string
} | null) {
  if (!row) return null
  return {
    ticker: row.ticker,
    content: row.content,
    updatedAt: row.updated_at,
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { ticker: rawTicker } = await params
  const ticker = normalizeTicker(rawTicker)
  if (!ticker) return err("Ticker không hợp lệ.", 400)

  const result = await auth.context.supabase
    .from("stock_notes")
    .select("ticker,content,updated_at")
    .eq("user_id", auth.context.user.id)
    .eq("ticker", ticker)
    .maybeSingle()

  if (result.error) {
    console.error("[Stock Notes] GET failed", result.error)
    return err("Không thể tải ghi chú.")
  }

  return NextResponse.json({ ok: true, note: publicNote(result.data) }, { headers: NO_STORE })
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { ticker: rawTicker } = await params
  const ticker = normalizeTicker(rawTicker)
  if (!ticker) return err("Ticker không hợp lệ.", 400)

  const body = await request.json().catch(() => null) as { content?: unknown } | null
  if (!body || typeof body.content !== "string") return err("Nội dung ghi chú không hợp lệ.", 400)

  const content = body.content.replace(/\r\n/g, "\n").trimEnd()
  if (content.length > NOTE_LIMIT) return err(`Ghi chú tối đa ${NOTE_LIMIT.toLocaleString("vi-VN")} ký tự.`, 400)

  if (!content.trim()) {
    const deleted = await auth.context.supabase
      .from("stock_notes")
      .delete()
      .eq("user_id", auth.context.user.id)
      .eq("ticker", ticker)

    if (deleted.error) {
      console.error("[Stock Notes] DELETE-empty failed", deleted.error)
      return err("Không thể xóa ghi chú.")
    }

    return NextResponse.json({ ok: true, note: null }, { headers: NO_STORE })
  }

  const result = await auth.context.supabase
    .from("stock_notes")
    .upsert(
      {
        user_id: auth.context.user.id,
        ticker,
        content,
      },
      { onConflict: "user_id,ticker" },
    )
    .select("ticker,content,updated_at")
    .single()

  if (result.error || !result.data) {
    console.error("[Stock Notes] PUT failed", result.error)
    return err("Không thể lưu ghi chú.")
  }

  return NextResponse.json({ ok: true, note: publicNote(result.data) }, { headers: NO_STORE })
}
