import { NextResponse } from "next/server"

import { requireApiUser, type ServerAuthContext } from "@/lib/auth/server"
import { getCanonicalUniverse } from "@/lib/market-universe"
import {
  hasRequiredFilterSectorSelections,
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

async function loadSettings(context: ServerAuthContext) {
  const userId = context.user.id
  const { data, error } = await context.supabase
    .from("user_preferences")
    .select("settings")
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return data?.settings ?? {}
}

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    const [universe, settings] = await Promise.all([
      getCanonicalUniverse(),
      loadSettings(auth.context),
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
      loadSettings(auth.context),
    ])
    const availableSectors = availableSectorsFromUniverse(universe)
    const criteria = normalizeStockFilterCriteria(
      (body as Record<string, unknown>).criteria,
      availableSectors,
      new Date().toISOString(),
    )
    if (!criteria || !hasRequiredFilterSectorSelections(new Set(criteria.sectors), availableSectors)) {
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
