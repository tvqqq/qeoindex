import { NextResponse } from "next/server"
import { requireApiUser } from "@/modules/auth/server"
import {
  ChartDataRequestError,
  ChartDataUnavailableError,
  type ChartResolution,
} from "@/modules/market/chart-data/contract"
import { chartHttpCachePolicy, type ChartHttpCachePolicy } from "@/modules/market/chart-data/http-cache-policy"
import {
  createChartPerformanceRecorder,
  type ChartPerfSnapshot,
} from "@/modules/market/chart-data/performance"
import { INTERACTIVE_CHART_PROVIDER_BUDGET_MS } from "@/modules/market/chart-data/provider-budget"
import { createPrimaryChartOhlcvProvider } from "@/modules/market/chart-data/provider"
import { getChartOhlcv } from "@/modules/market/chart-data/timeframe-service"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

function parseEpoch(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return NaN
  return Number(value)
}

function measuredJson(
  payload: Record<string, unknown>,
  startedAt: number,
  barCount: number,
  snapshot: ChartPerfSnapshot,
  cachePolicy: ChartHttpCachePolicy,
) {
  const serializationStartedAt = performance.now()
  const body = JSON.stringify(payload)
  const serializationMs = Math.max(0, performance.now() - serializationStartedAt)
  const durationMs = Math.max(0, performance.now() - startedAt)
  const stages = Object.entries(snapshot)
    .filter(([, measurement]) => measurement.count > 0)
    .map(([stage, measurement]) => `${stage};dur=${measurement.durationMs.toFixed(1)}`)
  const serverTiming = [
    `chart-data;dur=${durationMs.toFixed(1)}`,
    ...stages,
    `serialization;dur=${serializationMs.toFixed(1)}`,
  ].join(", ")

  return new NextResponse(body, {
    headers: {
      "Cache-Control": cachePolicy.cacheControl,
      ...(cachePolicy.cacheControl === "private, max-age=600" ? { Vary: cachePolicy.vary } : {}),
      "Content-Type": "application/json; charset=utf-8",
      "Server-Timing": serverTiming,
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
  const recorder = createChartPerformanceRecorder()
  const interactiveProvider = createPrimaryChartOhlcvProvider({
    totalBudgetMs: INTERACTIVE_CHART_PROVIDER_BUDGET_MS,
  })

  try {
    const result = await getChartOhlcv({
      supabase,
      performance: recorder,
      provider: interactiveProvider,
    }, { ticker, resolution, from, to })
    const cachePolicy = chartHttpCachePolicy({
      ticker: result.ticker,
      timeframe: result.resolution,
      from: result.from,
      to: result.to,
    }, result, new Date())
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
    }, startedAt, result.bars.length, recorder.snapshot(), cachePolicy)
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
