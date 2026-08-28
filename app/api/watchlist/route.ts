import { NextResponse } from "next/server"

import { requireApiUser, type ServerAuthContext } from "@/lib/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/
const MAX_SORT_ORDER = 10_000
const MAX_WATCHLISTS = 5
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function watchlistServerError(operation: string, error: unknown) {
  console.error(`[QeoIndex Watchlist] ${operation} failed`, error)
  return NextResponse.json(
    { ok: false, error: "Watchlist request failed." },
    { status: 500, headers: NO_STORE_HEADERS },
  )
}

function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE_HEADERS })
}

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

async function loadWatchlist(context: ServerAuthContext, watchlistId: string) {
  const items = await context.supabase
    .from("watchlist_items")
    .select("id,watchlist_id,ticker,sort_order,note,alert_price_above,alert_price_below,tags,created_at,updated_at")
    .eq("user_id", context.user.id)
    .eq("watchlist_id", watchlistId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (items.error) throw items.error
  return items.data ?? []
}

/**
 * GET /api/watchlist — returns all watchlists + items for the user.
 * Legacy: also returns the default watchlist as `watchlist` + `items` for backward compat.
 */
export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    // Get all watchlists
    const { data: watchlists, error: wlError } = await auth.context.supabase
      .from("watchlists")
      .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
      .eq("user_id", auth.context.user.id)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })

    if (wlError) throw wlError

    const allWatchlists = watchlists ?? []

    // Ensure at least one default watchlist exists
    let defaultWatchlist = allWatchlists.find((w) => w.is_default)
    if (!defaultWatchlist) {
      defaultWatchlist = await ensureDefaultWatchlist(auth.context)
      allWatchlists.push(defaultWatchlist)
    }

    // Load items for the default watchlist (legacy compat)
    const items = await loadWatchlist(auth.context, defaultWatchlist.id)

    return NextResponse.json(
      {
        ok: true,
        // Legacy fields (for existing board integration)
        watchlist: defaultWatchlist,
        items,
        // New fields
        watchlists: allWatchlists,
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return watchlistServerError("load", error)
  }
}

/**
 * POST /api/watchlist — add ticker to the default watchlist (legacy behavior)
 *                     OR create a new watchlist (when body has `createNew: true`).
 */
export async function POST(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null

  // Create new watchlist
  if (body?.createNew === true) {
    const name = String(body?.name ?? "").trim()
    if (!name || name.length > 80) return err("Tên danh sách không hợp lệ (1-80 ký tự).")

    const { count } = await auth.context.supabase
      .from("watchlists")
      .select("*", { count: "exact", head: true })
      .eq("user_id", auth.context.user.id)

    if ((count ?? 0) >= MAX_WATCHLISTS) {
      return err(`Tối đa ${MAX_WATCHLISTS} danh sách theo dõi.`)
    }

    try {
      const { data, error } = await auth.context.supabase
        .from("watchlists")
        .insert({
          user_id: auth.context.user.id,
          name,
          is_default: false,
          sort_order: count ?? 0,
        })
        .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
        .single()

      if (error || !data) throw error
      return NextResponse.json({ ok: true, watchlist: data }, { status: 201, headers: NO_STORE_HEADERS })
    } catch (error) {
      return watchlistServerError("create-watchlist", error)
    }
  }

  // Add ticker to default watchlist (or specified watchlist via watchlistId)
  const ticker = String(body?.ticker ?? "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const requestedSortOrder = Number(body?.sortOrder ?? 0)
  const sortOrder = Number.isInteger(requestedSortOrder)
    ? Math.max(0, Math.min(MAX_SORT_ORDER, requestedSortOrder))
    : 0

  // Optional extended fields
  const note = body?.note ? String(body.note).slice(0, 2000) : null
  const alertPriceAbove = body?.alertPriceAbove != null ? Number(body.alertPriceAbove) : null
  const alertPriceBelow = body?.alertPriceBelow != null ? Number(body.alertPriceBelow) : null
  const tags = Array.isArray(body?.tags)
    ? (body.tags as unknown[]).map((t) => String(t).slice(0, 50)).slice(0, 10)
    : []

  // Target watchlist: specified or default
  let watchlistId: string | null = null
  if (body?.watchlistId && UUID_RE.test(String(body.watchlistId))) {
    watchlistId = String(body.watchlistId)
  }

  try {
    let targetWatchlist: { id: string }
    if (watchlistId) {
      const { data } = await auth.context.supabase
        .from("watchlists")
        .select("id")
        .eq("id", watchlistId)
        .eq("user_id", auth.context.user.id)
        .single()
      if (!data) return err("Danh sách không tồn tại.", 404)
      targetWatchlist = data
    } else {
      targetWatchlist = await ensureDefaultWatchlist(auth.context)
    }

    const result = await auth.context.supabase
      .from("watchlist_items")
      .upsert(
        {
          watchlist_id: targetWatchlist.id,
          user_id: auth.context.user.id,
          ticker,
          sort_order: sortOrder,
          note,
          alert_price_above: alertPriceAbove !== null && Number.isFinite(alertPriceAbove) ? alertPriceAbove : null,
          alert_price_below: alertPriceBelow !== null && Number.isFinite(alertPriceBelow) ? alertPriceBelow : null,
          tags,
        },
        { onConflict: "watchlist_id,ticker" },
      )
      .select("id,watchlist_id,ticker,sort_order,note,alert_price_above,alert_price_below,tags,created_at,updated_at")
      .single()

    if (result.error) throw result.error
    return NextResponse.json(
      { ok: true, watchlistId: targetWatchlist.id, item: result.data },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return watchlistServerError("upsert", error)
  }
}

/**
 * DELETE /api/watchlist?ticker=VCB — remove ticker from default (or specified) watchlist.
 * Also supports deleting a whole watchlist: ?watchlistId=xxx
 */
export async function DELETE(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const searchParams = new URL(request.url).searchParams
  const watchlistId = searchParams.get("watchlistId")

  // Delete entire watchlist
  if (watchlistId) {
    if (!UUID_RE.test(watchlistId)) return err("Watchlist ID không hợp lệ.")

    // Prevent deleting the last watchlist
    const { count } = await auth.context.supabase
      .from("watchlists")
      .select("*", { count: "exact", head: true })
      .eq("user_id", auth.context.user.id)

    if ((count ?? 0) <= 1) return err("Không thể xóa danh sách duy nhất.")

    const { error } = await auth.context.supabase
      .from("watchlists")
      .delete()
      .eq("id", watchlistId)
      .eq("user_id", auth.context.user.id)

    if (error) return watchlistServerError("delete-watchlist", error)
    return NextResponse.json({ ok: true, watchlistId }, { headers: NO_STORE_HEADERS })
  }

  // Remove ticker from watchlist
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const targetWatchlistId = searchParams.get("wid")

  try {
    let wlId: string
    if (targetWatchlistId && UUID_RE.test(targetWatchlistId)) {
      wlId = targetWatchlistId
    } else {
      const wl = await ensureDefaultWatchlist(auth.context)
      wlId = wl.id
    }

    const result = await auth.context.supabase
      .from("watchlist_items")
      .delete()
      .eq("user_id", auth.context.user.id)
      .eq("watchlist_id", wlId)
      .eq("ticker", ticker)

    if (result.error) throw result.error
    return NextResponse.json({ ok: true, ticker }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return watchlistServerError("delete", error)
  }
}
