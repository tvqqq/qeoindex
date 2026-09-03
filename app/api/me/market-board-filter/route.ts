import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"
import { getCanonicalUniverse } from "@/lib/market-universe"
import {
  mergeStockFilterIntoSettings,
  normalizeStockFilterCriteria,
  readStockFilterFromSettings,
} from "@/lib/market-board/stock-filter"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}
const MAX_SETTINGS_BYTES = 16 * 1024

function availableSectorsFromUniverse(universe: Awaited<ReturnType<typeof getCanonicalUniverse>>) {
  return [...new Set(universe.stocks.map((stock) => String(stock.sector ?? "").trim()).filter(Boolean))]
}

async function loadSettings(userId: string, supabase: Awaited<ReturnType<typeof requireApiUser>> extends { ok: true; context: infer C } ? C extends { supabase: infer S } ? S : never : never) {
  const result = await (supabase as any)
    .from("user_preferences")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle()
  if (result.error) throw result.error
  return result.data?.settings ?? {}
}

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    const userId = auth.context.user.id
    const [universe, settings] = await Promise.all([
      getCanonicalUniverse(),
      loadSettings(userId, auth.context.supabase as any),
    ])
    const criteria = readStockFilterFromSettings(settings, availableSectorsFromUniverse(universe))
    return NextResponse.json({ ok: true, criteria }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[Market Board Filter] load failed", error)
    return NextResponse.json({ ok: false, error: "Unable to load market board filter." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function PUT(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const userId = auth.context.user.id
    const [universe, settings] = await Promise.all([
      getCanonicalUniverse(),
      loadSettings(userId, auth.context.supabase as any),
    ])
    const criteria = normalizeStockFilterCriteria(
      (body as Record<string, unknown>).criteria,
      availableSectorsFromUniverse(universe),
      new Date().toISOString(),
    )
    if (!criteria) {
      return NextResponse.json({ ok: false, error: "Invalid stock filter criteria." }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const mergedSettings = mergeStockFilterIntoSettings(settings, criteria)
    const encodedSettings = JSON.stringify(mergedSettings)
    if (Buffer.byteLength(encodedSettings, "utf8") > MAX_SETTINGS_BYTES) {
      return NextResponse.json({ ok: false, error: "Settings payload is too large." }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const { error } = await auth.context.supabase
      .from("user_preferences")
      .upsert({ user_id: userId, settings: mergedSettings })
    if (error) throw error

    return NextResponse.json({ ok: true, criteria }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    console.error("[Market Board Filter] save failed", error)
    return NextResponse.json({ ok: false, error: "Unable to save market board filter." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
