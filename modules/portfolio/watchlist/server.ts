import "server-only"

import { NextResponse } from "next/server"

import { requireApiUser, type ServerAuthContext } from "@/modules/auth/server"

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/
const MAX_SORT_ORDER = 10_000
const MAX_WATCHLISTS = 5
const MAX_WATCHLIST_ITEMS = 300
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

async function loadOwnedWatchlists(context: ServerAuthContext) {
  const { data, error } = await context.supabase
    .from("watchlists")
    .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
    .eq("user_id", context.user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) throw error
  const watchlists = data ?? []
  let defaultWatchlist = watchlists.find((watchlist) => watchlist.is_default)
  if (!defaultWatchlist) {
    defaultWatchlist = await ensureDefaultWatchlist(context)
    watchlists.push(defaultWatchlist)
    watchlists.sort((left, right) => left.sort_order - right.sort_order)
  }
  return { watchlists, defaultWatchlist }
}

async function createWatchlist(context: ServerAuthContext, nameInput: unknown) {
  const name = String(nameInput ?? "").trim()
  if (!name || name.length > 80) return err("Tên danh sách không hợp lệ (1-80 ký tự).")

  const { count, error: countError } = await context.supabase
    .from("watchlists")
    .select("*", { count: "exact", head: true })
    .eq("user_id", context.user.id)

  if (countError) throw countError
  if ((count ?? 0) >= MAX_WATCHLISTS) {
    return err(`Tối đa ${MAX_WATCHLISTS} danh sách theo dõi.`)
  }

  const { data, error } = await context.supabase
    .from("watchlists")
    .insert({
      user_id: context.user.id,
      name,
      is_default: false,
      sort_order: count ?? 0,
    })
    .select("id,user_id,name,is_default,sort_order,created_at,updated_at")
    .single()

  if (error || !data) throw error
  return NextResponse.json({ ok: true, watchlist: data }, { status: 201, headers: NO_STORE_HEADERS })
}

/**
 * GET /api/watchlist
 * - without wid: returns all watchlists + default items (legacy contract)
 * - with ?wid=<uuid>: returns all watchlists + the requested owned watchlist items
 */
export async function handleWatchlistGet(request?: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    const { watchlists, defaultWatchlist } = await loadOwnedWatchlists(auth.context)
    const requestedId = request ? new URL(request.url).searchParams.get("wid") : null
    const requestedWatchlist = requestedId && UUID_RE.test(requestedId)
      ? watchlists.find((watchlist) => watchlist.id === requestedId)
      : null

    if (requestedId && !requestedWatchlist) return err("Danh sách không tồn tại.", 404)

    const watchlist = requestedWatchlist ?? defaultWatchlist
    const items = await loadWatchlist(auth.context, watchlist.id)

    return NextResponse.json(
      {
        ok: true,
        watchlist,
        activeWatchlistId: watchlist.id,
        items,
        watchlists,
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    return watchlistServerError("load", error)
  }
}

/**
 * POST /api/watchlist
 * - { createNew: true, name }: create a watchlist
 * - { ticker, watchlistId? }: add/update a ticker
 */
export async function handleWatchlistPost(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null

  if (body?.createNew === true) {
    try {
      return await createWatchlist(auth.context, body.name)
    } catch (error) {
      return watchlistServerError("create-watchlist", error)
    }
  }

  const ticker = String(body?.ticker ?? "").trim().toUpperCase()
  if (!TICKER_PATTERN.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const rawSortOrder = body?.sortOrder ?? body?.sort_order ?? 0
  const requestedSortOrder = Number(rawSortOrder)
  const sortOrder = Number.isInteger(requestedSortOrder)
    ? Math.max(0, Math.min(MAX_SORT_ORDER, requestedSortOrder))
    : 0

  const note = body?.note ? String(body.note).slice(0, 2000) : null
  const rawAlertAbove = body?.alertPriceAbove ?? body?.alert_price_above
  const rawAlertBelow = body?.alertPriceBelow ?? body?.alert_price_below
  const alertPriceAbove = rawAlertAbove != null ? Number(rawAlertAbove) : null
  const alertPriceBelow = rawAlertBelow != null ? Number(rawAlertBelow) : null
  const tags = Array.isArray(body?.tags)
    ? (body.tags as unknown[]).map((tag) => String(tag).slice(0, 50)).slice(0, 10)
    : []

  const rawWatchlistId = body?.watchlistId ?? body?.watchlist_id
  const watchlistId = rawWatchlistId && UUID_RE.test(String(rawWatchlistId))
    ? String(rawWatchlistId)
    : null

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

    const existingCount = await auth.context.supabase
      .from("watchlist_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", auth.context.user.id)
      .eq("watchlist_id", targetWatchlist.id)

    if (existingCount.error) throw existingCount.error
    if ((existingCount.count ?? 0) >= MAX_WATCHLIST_ITEMS) {
      const existingTicker = await auth.context.supabase
        .from("watchlist_items")
        .select("id")
        .eq("user_id", auth.context.user.id)
        .eq("watchlist_id", targetWatchlist.id)
        .eq("ticker", ticker)
        .maybeSingle()
      if (!existingTicker.data) return err(`Tối đa ${MAX_WATCHLIST_ITEMS} mã cho mỗi watchlist.`)
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

/** PUT is retained for the existing Portfolio Watchlist UI create contract. */
export async function handleWatchlistPut(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    return await createWatchlist(auth.context, body?.name)
  } catch (error) {
    return watchlistServerError("create-watchlist", error)
  }
}

/**
 * PATCH /api/watchlist — persist a complete custom order for an owned watchlist.
 * Body: { watchlistId, tickers: string[] }
 */
export async function handleWatchlistPatch(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  const watchlistId = String(body?.watchlistId ?? body?.watchlist_id ?? "")
  const rawTickers = Array.isArray(body?.tickers) ? body.tickers : []

  if (!UUID_RE.test(watchlistId)) return err("Watchlist ID không hợp lệ.")
  if (rawTickers.length > MAX_WATCHLIST_ITEMS) return err("Danh sách sắp xếp vượt giới hạn.")

  const tickers = rawTickers.map((value) => String(value).trim().toUpperCase())
  if (tickers.some((ticker) => !TICKER_PATTERN.test(ticker))) return err("Danh sách mã không hợp lệ.")
  if (new Set(tickers).size !== tickers.length) return err("Danh sách mã bị trùng.")

  try {
    const { data: owned } = await auth.context.supabase
      .from("watchlists")
      .select("id")
      .eq("id", watchlistId)
      .eq("user_id", auth.context.user.id)
      .maybeSingle()
    if (!owned) return err("Danh sách không tồn tại.", 404)

    const existing = await loadWatchlist(auth.context, watchlistId)
    const existingSet = new Set(existing.map((item) => item.ticker))
    if (existingSet.size !== tickers.length || tickers.some((ticker) => !existingSet.has(ticker))) {
      return err("Thứ tự watchlist đã thay đổi. Vui lòng tải lại.")
    }

    if (tickers.length) {
      const payload = tickers.map((ticker, index) => ({
        watchlist_id: watchlistId,
        user_id: auth.context.user.id,
        ticker,
        sort_order: index,
      }))
      const { error } = await auth.context.supabase
        .from("watchlist_items")
        .upsert(payload, { onConflict: "watchlist_id,ticker" })
      if (error) throw error
    }

    return NextResponse.json({ ok: true, watchlistId, tickers }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return watchlistServerError("reorder", error)
  }
}

/**
 * DELETE /api/watchlist
 * - ?ticker=VCB&wid=<uuid>: remove ticker
 * - ?id=<item uuid>: remove item by id (Portfolio UI compatibility)
 * - ?watchlistId=<uuid> or ?wid=<uuid> without ticker/id: delete watchlist
 */
export async function handleWatchlistDelete(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const searchParams = new URL(request.url).searchParams
  const itemId = searchParams.get("id")
  const ticker = (searchParams.get("ticker") ?? "").trim().toUpperCase()
  const explicitWatchlistId = searchParams.get("watchlistId")
  const wid = searchParams.get("wid")
  const deleteWatchlistId = explicitWatchlistId ?? (!itemId && !ticker ? wid : null)

  if (deleteWatchlistId) {
    if (!UUID_RE.test(deleteWatchlistId)) return err("Watchlist ID không hợp lệ.")

    const { count } = await auth.context.supabase
      .from("watchlists")
      .select("*", { count: "exact", head: true })
      .eq("user_id", auth.context.user.id)

    if ((count ?? 0) <= 1) return err("Không thể xóa danh sách duy nhất.")

    const { error } = await auth.context.supabase
      .from("watchlists")
      .delete()
      .eq("id", deleteWatchlistId)
      .eq("user_id", auth.context.user.id)

    if (error) return watchlistServerError("delete-watchlist", error)
    return NextResponse.json({ ok: true, watchlistId: deleteWatchlistId }, { headers: NO_STORE_HEADERS })
  }

  try {
    if (itemId) {
      if (!UUID_RE.test(itemId)) return err("Watchlist item ID không hợp lệ.")
      const result = await auth.context.supabase
        .from("watchlist_items")
        .delete()
        .eq("id", itemId)
        .eq("user_id", auth.context.user.id)
      if (result.error) throw result.error
      return NextResponse.json({ ok: true, id: itemId }, { headers: NO_STORE_HEADERS })
    }

    if (!TICKER_PATTERN.test(ticker)) {
      return NextResponse.json({ ok: false, error: "Ticker không hợp lệ." }, { status: 400, headers: NO_STORE_HEADERS })
    }

    let watchlistId: string
    if (wid && UUID_RE.test(wid)) {
      const { data } = await auth.context.supabase
        .from("watchlists")
        .select("id")
        .eq("id", wid)
        .eq("user_id", auth.context.user.id)
        .maybeSingle()
      if (!data) return err("Danh sách không tồn tại.", 404)
      watchlistId = data.id
    } else {
      const watchlist = await ensureDefaultWatchlist(auth.context)
      watchlistId = watchlist.id
    }

    const result = await auth.context.supabase
      .from("watchlist_items")
      .delete()
      .eq("user_id", auth.context.user.id)
      .eq("watchlist_id", watchlistId)
      .eq("ticker", ticker)

    if (result.error) throw result.error
    return NextResponse.json({ ok: true, ticker }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return watchlistServerError("delete", error)
  }
}
