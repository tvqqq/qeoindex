import { NextResponse } from "next/server"
import { requireApiFeature } from "@/modules/auth/server"
import { ChartDataRequestError, ChartDataUnavailableError, type CanonicalChartResolution } from "@/modules/market/chart-data/contract"
import { getCanonicalChartOhlcv } from "@/modules/market/chart-data/service"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

function parseEpoch(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return NaN
  return Number(value)
}

export async function GET(request: Request) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Canonical market data service unavailable." }, { status: 503, headers: NO_STORE })
  }

  const url = new URL(request.url)
  const ticker = String(url.searchParams.get("ticker") || "").trim().toUpperCase()
  const resolution = String(url.searchParams.get("resolution") || "") as CanonicalChartResolution
  const from = parseEpoch(url.searchParams.get("from"))
  const to = parseEpoch(url.searchParams.get("to"))

  try {
    const result = await getCanonicalChartOhlcv({ supabase }, { ticker, resolution, from, to })
    return NextResponse.json({
      ok: true,
      ticker: result.ticker,
      resolution: result.resolution,
      from: result.from,
      to: result.to,
      bars: result.bars,
      gaps: result.gaps,
      integrityIssues: result.integrityIssues,
      coverage: result.coverage,
      errors: result.errors,
      generatedAt: new Date().toISOString(),
    }, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof ChartDataRequestError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400, headers: NO_STORE })
    }
    if (error instanceof ChartDataUnavailableError) {
      return NextResponse.json({ ok: false, error: "Canonical market data unavailable." }, { status: 503, headers: NO_STORE })
    }
    return NextResponse.json({ ok: false, error: "Unable to load canonical market data." }, { status: 503, headers: NO_STORE })
  }
}
