import { NextResponse } from "next/server"

import { requireApiUser, type ServerAuthContext } from "@/modules/auth/server"
import {
  mergeIndustryOrderIntoSettings,
  normalizeSavedIndustryOrder,
  readIndustryOrderFromSettings,
} from "@/modules/market/board/industry-priceboard"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}
const MAX_BODY_BYTES = 8 * 1024
const MAX_SETTINGS_BYTES = 16 * 1024
const MAX_CONFLICT_RETRIES = 3

async function readPreferences(context: ServerAuthContext) {
  const { data, error } = await context.supabase
    .from("user_preferences")
    .select("settings,updated_at")
    .eq("user_id", context.user.id)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    const row = await readPreferences(auth.context)
    return NextResponse.json({
      ok: true,
      order: readIndustryOrderFromSettings(row?.settings),
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[Industry Order] load failed", error)
    return NextResponse.json({ ok: false, error: "Unable to load industry order." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const raw = await request.text().catch(() => "")
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "Invalid order payload." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  let body: unknown = null
  try { body = JSON.parse(raw) } catch { /* validated below */ }
  const candidate = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).order
    : undefined
  const order = normalizeSavedIndustryOrder(candidate)
  if (!order) {
    return NextResponse.json({ ok: false, error: "Invalid industry order." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const userId = auth.context.user.id
    // Avoid overwriting unrelated settings written by another user-preferences endpoint.
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt += 1) {
      const current = await readPreferences(auth.context)
      const settings = mergeIndustryOrderIntoSettings(current?.settings, order)
      if (Buffer.byteLength(JSON.stringify(settings), "utf8") > MAX_SETTINGS_BYTES) {
        return NextResponse.json({ ok: false, error: "Settings payload is too large." }, { status: 400, headers: NO_STORE_HEADERS })
      }

      if (!current) {
        const { error } = await auth.context.supabase
          .from("user_preferences")
          .insert({ user_id: userId, settings })
        if (!error) return NextResponse.json({ ok: true, order }, { headers: NO_STORE_HEADERS })
        if (error.code === "23505") continue
        throw error
      }

      const { data, error } = await auth.context.supabase
        .from("user_preferences")
        .update({ settings })
        .eq("user_id", userId)
        .eq("updated_at", current.updated_at)
        .select("user_id")
        .maybeSingle()
      if (error) throw error
      if (data) return NextResponse.json({ ok: true, order }, { headers: NO_STORE_HEADERS })
    }

    return NextResponse.json({ ok: false, error: "Preferences changed during save. Retry." }, { status: 409, headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[Industry Order] save failed", error)
    return NextResponse.json({ ok: false, error: "Unable to save industry order." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
