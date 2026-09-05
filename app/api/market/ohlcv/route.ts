import { NextResponse } from "next/server"
import { requireApiUser } from "@/modules/auth/server"
import {
  ChartDataRequestError,
  ChartDataUnavailableError,
  type ChartResolution,
} from "@/modules/market/chart-data/contract"
import { getChartOhlcv } from "@/modules/market/chart-data/timeframe-service"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

function parseEpoch(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return NaN
  return Number(value)
}

function measuredJson(payload: Record<string, unknown>, startedAt: number, barCount: number) {
  const body = JSON.stringify(payload)
  const durationMs = Math.max(0, performance.now() - startedAt)
  return new NextResponse(body, {
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Server-Timing": `chart-data;dur=${durationMs.toFixed(1)}`,
      "X-Chart-Bar-Count": String(barCount),
      "X-Chart-Payload-Bytes": String(Buffer.byteLength(body, "utf8")),
    },
  })
}

export async function GET(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Canonical market data service unavailable." }, { status: 503, headers: NO_STORE })
  }

  const url = new URL(request.url)
  const ticker = String(url.searchParams.get("ticker") || "").trim().toUpperCase()
  const resolution = String(url.searchParams.get("resolution") || "") as ChartResolution
  const from = parseEpoch(url.searchParams.get("from"))
  const to = parseEpoch(url.searchParams.get("to"))
  const startedAt = performance.now()

  try {
    const result = await getChartOhlcv({ supabase }, { ticker, resolution, from, to })
    return measuredJson({
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
      metadata: result.metadata ?? null,
      generatedAt: new Date().toISOString(),
    }, startedAt, result.bars.length)
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
