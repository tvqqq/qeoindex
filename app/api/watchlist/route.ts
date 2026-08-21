import { NextResponse } from "next/server"

import { requireApiUser, type ServerAuthContext } from "@/lib/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

async function ensureDefaultWatchlist(context: ServerAuthContext) {
  const userId = context.user.id
  const existing = await context.supabase
    .from("watchlists")
    .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle()

  if (existing.error) throw existing.error
  if (existing.data) return existing.data

  const inserted = await context.supabase
    .from("watchlists")
    .insert({ user_id: userId, name: "Theo dõi", is_default: true, sort_order: 0 })
    .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
    .single()

  if (!inserted.error && inserted.data) return inserted.data

  const fallback = await context.supabase
    .from("watchlists")
    .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
    .eq("user_id", userId)
    .eq("is_default", true)
    .single()
  if (fallback.error) throw inserted.error ?? fallback.error
  return fallback.data
}

async function loadDefaultWatchlist(context: ServerAuthContext) {
  const watchlist = await ensureDefaultWatchlist(context)
  const items = await context.supabase
    .from("watchlist_items")
    .select("id,watchlist_id,ticker,sort_order,created_at,updated_at")
    .eq("user_id", context.user.id)
    .eq("watchlist_id", watchlist.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (items.error) throw items.error
  return { watchlist, items: items.data ?? [] }
}

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json({ ok: true, ...(await loadDefaultWatchlist(auth.context)) }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null) as { ticker?: unknown; sortOrder?: unknown } | null
  const ticker = String(body?.ticker ?? "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const sortOrder = Number.isInteger(body?.sortOrder) ? Number(body?.sortOrder) : 0

  try {
    const watchlist = await ensureDefaultWatchlist(auth.context)
    const result = await auth.context.supabase
      .from("watchlist_items")
      .upsert({
        watchlist_id: watchlist.id,
        user_id: auth.context.user.id,
        ticker,
        sort_order: sortOrder,
      }, { onConflict: "watchlist_id,ticker" })
      .select("id,watchlist_id,ticker,sort_order,created_at,updated_at")
      .single()

    if (result.error) throw result.error
    return NextResponse.json({ ok: true, watchlistId: watchlist.id, item: result.data }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const ticker = (new URL(request.url).searchParams.get("ticker") ?? "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const watchlist = await ensureDefaultWatchlist(auth.context)
    const result = await auth.context.supabase
      .from("watchlist_items")
      .delete()
      .eq("user_id", auth.context.user.id)
      .eq("watchlist_id", watchlist.id)
      .eq("ticker", ticker)

    if (result.error) throw result.error
    return NextResponse.json({ ok: true, ticker }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
