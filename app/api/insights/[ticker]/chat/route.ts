import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import {
  answerTickerQuestion,
  TickerQaError,
  type TickerQaTelemetry,
} from "@/modules/ticker-qa/service"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { createServerTickerKnowledgeIndex } from "@/modules/ticker-knowledge/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }

function tickerQaEnabled() {
  return (process.env.TICKER_QA_ENABLED ?? "").trim().toLowerCase() === "true"
}

function publicTickerQaErrorMessage(code: TickerQaError["code"]) {
  switch (code) {
    case "invalid_request":
      return "Invalid ticker Q&A request"
    case "feature_disabled":
      return "Ticker Q&A is not enabled"
    case "service_unavailable":
    case "provider_failed":
    case "invalid_model_output":
      return "Ticker Q&A is temporarily unavailable"
  }
}

function recordTickerQaTelemetry(metric: TickerQaTelemetry) {
  console.info("[QEO-118_TICKER_QA]", JSON.stringify(metric))
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  if (!tickerQaEnabled()) {
    return NextResponse.json(
      { ok: false, error: "Ticker Q&A is not enabled", code: "feature_disabled" },
      { status: 503, headers: NO_STORE },
    )
  }

  const { ticker: rawTicker } = await params
  let ticker = ""
  try {
    ticker = decodeURIComponent(rawTicker ?? "").trim().toUpperCase()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid ticker", code: "invalid_request" },
      { status: 400, headers: NO_STORE },
    )
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body", code: "malformed_json" },
      { status: 400, headers: NO_STORE },
    )
  }
  const payload = body as Record<string, unknown>

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Ticker Q&A service is unavailable", code: "service_unavailable" },
      { status: 503, headers: NO_STORE },
    )
  }

  let index: ReturnType<typeof createServerTickerKnowledgeIndex> | undefined
  try {
    index = createServerTickerKnowledgeIndex()
  } catch {
    index = undefined
  }

  try {
    const result = await answerTickerQuestion(
      supabase as unknown as Parameters<typeof answerTickerQuestion>[0],
      {
        ticker: ticker,
        question: typeof payload.question === "string" ? payload.question : "",
        history: payload.history as Parameters<typeof answerTickerQuestion>[1]["history"],
      },
      {
        index: index,
        recordTelemetry: recordTickerQaTelemetry,
      },
    )

    return NextResponse.json(
      { ok: true, result },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof TickerQaError) {
      return NextResponse.json(
        { ok: false, error: publicTickerQaErrorMessage(error.code), code: error.code },
        { status: error.httpStatus, headers: NO_STORE },
      )
    }

    return NextResponse.json(
      { ok: false, error: "Ticker Q&A failed", code: "internal_error" },
      { status: 500, headers: NO_STORE },
    )
  }
}
