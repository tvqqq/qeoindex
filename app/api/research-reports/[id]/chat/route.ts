import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import {
  answerResearchReportQuestion,
  ResearchReportQaError,
} from "@/modules/research-reports"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function publicQaErrorMessage(code: ResearchReportQaError["code"]) {
  switch (code) {
    case "invalid_request":
      return "Invalid research report Q&A request"
    case "report_not_found":
      return "Research report not found"
    case "report_not_ready":
      return "Research report analysis is not ready"
    case "retrieval_failed":
    case "provider_failed":
    case "invalid_model_output":
      return "Research report Q&A is temporarily unavailable"
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  const { id: rawId } = await params
  const id = (rawId ?? "").trim()
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { ok: false, error: "Invalid research report id", code: "invalid_request" },
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

  const supabase = getSupabaseServerClient()
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Research report service is unavailable", code: "service_unavailable" },
      { status: 503, headers: NO_STORE },
    )
  }

  try {
    const payload = body as Record<string, unknown>
    const result = await answerResearchReportQuestion(
      supabase as unknown as Parameters<typeof answerResearchReportQuestion>[0],
      {
        reportId: id,
        question: typeof payload.question === "string" ? payload.question : "",
        history: payload.history as Parameters<typeof answerResearchReportQuestion>[1]["history"],
      },
    )

    return NextResponse.json(
      { ok: true, result },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    if (error instanceof ResearchReportQaError) {
      return NextResponse.json(
        { ok: false, error: publicQaErrorMessage(error.code), code: error.code },
        { status: error.httpStatus, headers: NO_STORE },
      )
    }

    return NextResponse.json(
      { ok: false, error: "Research report Q&A failed", code: "internal_error" },
      { status: 500, headers: NO_STORE },
    )
  }
}
