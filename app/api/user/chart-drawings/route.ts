import { NextResponse } from "next/server"
import { requireApiUser } from "@/modules/auth/server"
import {
  MAX_DRAWINGS_PER_TICKER,
  deserializeUserChartSettings,
  migrateDrawings,
  validateDrawingsCollectionV2,
} from "@/components/stock-detail/chart/drawings"
import type { ChartTimeframe } from "@/components/stock-detail/chart/stock-chart-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const MAX_PAYLOAD_BYTES = 256 * 1024

interface ChartDrawingPayload {
  ticker: string
  timeframe?: string
  chartStyle?: string
  indicators?: Record<string, boolean>
  drawingsSchemaVersion?: number
  drawings?: unknown[]
  unresolvedLegacyDrawings?: unknown[]
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === "object" && !Array.isArray(val)
}

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, unauthenticated: true }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const { searchParams } = new URL(request.url)
  const ticker = (searchParams.get("ticker") || "").toUpperCase().trim()
  if (!ticker) {
    return NextResponse.json({ ok: false, error: "Missing ticker parameter." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  try {
    const userId = auth.context.user.id
    const { data, error } = await auth.context.supabase
      .from("user_preferences")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle()

    if (error) throw error

    const settings = isPlainObject(data?.settings) ? data.settings : {}
    const charts = isPlainObject(settings.charts) ? (settings.charts as Record<string, unknown>) : {}
    const tickerData = isPlainObject(charts[ticker]) ? charts[ticker] : null

    if (!tickerData) {
      return NextResponse.json(
        {
          ok: true,
          data: {
            ticker,
            timeframe: "1D",
            chartStyle: "candles",
            indicators: {},
            drawingsSchemaVersion: 2,
            drawings: [],
          },
        },
        { headers: NO_STORE_HEADERS },
      )
    }

    const { settings: normalizedSettings } = deserializeUserChartSettings(tickerData)

    return NextResponse.json(
      {
        ok: true,
        data: normalizedSettings,
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch (err) {
    console.error("[Chart Drawings API] GET failed:", err)
    return NextResponse.json({ ok: false, error: "Failed to fetch user chart settings." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function POST(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) {
    return NextResponse.json({ ok: false, unauthenticated: true }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const body = (await request.json().catch(() => null)) as ChartDrawingPayload | null
  if (!isPlainObject(body) || !body.ticker || typeof body.ticker !== "string") {
    return NextResponse.json({ ok: false, error: "Invalid chart payload." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const ticker = body.ticker.toUpperCase().trim()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
    return NextResponse.json({ ok: false, error: "Invalid ticker format." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const encoded = JSON.stringify(body)
  if (Buffer.byteLength(encoded, "utf8") > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ ok: false, error: "Chart drawings payload is too large." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const rawDrawings = Array.isArray(body.drawings) ? body.drawings : []
  if (rawDrawings.length > MAX_DRAWINGS_PER_TICKER) {
    return NextResponse.json(
      { ok: false, error: `Maximum of ${MAX_DRAWINGS_PER_TICKER} drawings exceeded.` },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  let finalDrawings: unknown[] = []
  let finalUnresolved: unknown[] = Array.isArray(body.unresolvedLegacyDrawings) ? body.unresolvedLegacyDrawings : []

  if (body.drawingsSchemaVersion === 2) {
    const validation = validateDrawingsCollectionV2(rawDrawings)
    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: `Drawing validation failed: ${validation.errors.join("; ")}` },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    finalDrawings = rawDrawings
  } else {
    const migration = migrateDrawings(rawDrawings, {
      defaultTimeframe: (body.timeframe as ChartTimeframe) || "1D",
    })
    finalDrawings = migration.migrated
    finalUnresolved = [...finalUnresolved, ...migration.unresolved]
  }

  try {
    const userId = auth.context.user.id
    const { data: existingPref, error: fetchErr } = await auth.context.supabase
      .from("user_preferences")
      .select("settings")
      .eq("user_id", userId)
      .maybeSingle()

    if (fetchErr) throw fetchErr

    const currentSettings = isPlainObject(existingPref?.settings) ? existingPref.settings : {}
    const currentCharts = isPlainObject(currentSettings.charts)
      ? (currentSettings.charts as Record<string, unknown>)
      : {}

    const updatedCharts = {
      ...currentCharts,
      [ticker]: {
        ticker,
        timeframe: body.timeframe || "1D",
        chartStyle: body.chartStyle || "candles",
        indicators: body.indicators || {},
        drawingsSchemaVersion: 2,
        drawings: finalDrawings,
        ...(finalUnresolved.length > 0 ? { unresolvedLegacyDrawings: finalUnresolved } : {}),
        updatedAt: new Date().toISOString(),
      },
    }

    const newSettings = {
      ...currentSettings,
      charts: updatedCharts,
    }

    const { error: upsertErr } = await auth.context.supabase.from("user_preferences").upsert(
      {
        user_id: userId,
        settings: newSettings,
      },
      { onConflict: "user_id" },
    )

    if (upsertErr) throw upsertErr

    return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    console.error("[Chart Drawings API] POST failed:", err)
    return NextResponse.json({ ok: false, error: "Failed to persist user chart settings." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
