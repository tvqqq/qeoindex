import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const MAX_PORTFOLIOS = 5

function err(msg: string, status = 500) {
  return NextResponse.json({ ok: false, error: msg }, { status, headers: NO_STORE })
}

/** GET /api/portfolio — list all portfolios for the authenticated user */
export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const { data, error } = await auth.context.supabase
    .from("portfolios")
    .select("id,user_id,name,description,is_default,sort_order,created_at,updated_at")
    .eq("user_id", auth.context.user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    console.error("[Portfolio] GET failed", error)
    return err("Failed to load portfolios.")
  }

  return NextResponse.json({ ok: true, portfolios: data ?? [] }, { headers: NO_STORE })
}

/** POST /api/portfolio — create a new portfolio */
export async function POST(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  // Count existing portfolios
  const { count, error: countError } = await auth.context.supabase
    .from("portfolios")
    .select("*", { count: "exact", head: true })
    .eq("user_id", auth.context.user.id)

  if (countError) {
    console.error("[Portfolio] count failed", countError)
    return err("Failed to create portfolio.")
  }

  if ((count ?? 0) >= MAX_PORTFOLIOS) {
    return err(`Tối đa ${MAX_PORTFOLIOS} danh mục đầu tư.`, 400)
  }

  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown } | null
  const name = String(body?.name ?? "").trim()
  if (!name || name.length > 80) {
    return err("Tên danh mục không hợp lệ (1-80 ký tự).", 400)
  }

  const { data, error } = await auth.context.supabase
    .from("portfolios")
    .insert({
      user_id: auth.context.user.id,
      name,
      description: body?.description ? String(body.description).slice(0, 500) : null,
      is_default: (count ?? 0) === 0,
      sort_order: count ?? 0,
    })
    .select("id,user_id,name,description,is_default,sort_order,created_at,updated_at")
    .single()

  if (error || !data) {
    console.error("[Portfolio] insert failed", error)
    return err("Failed to create portfolio.")
  }

  return NextResponse.json({ ok: true, portfolio: data }, { status: 201, headers: NO_STORE })
}
