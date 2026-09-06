import { NextResponse } from "next/server"

import { requireApiFeature } from "@/modules/auth/server"
import {
  answerResearchReportQuestion,
  ResearchReportQaError,
} from "@/modules/research-reports"
import { retrieveResearchReportQaHybridEvidence } from "@/modules/research-reports/qa/hybrid-retrieval"
import type { ResearchReportQaRetrievalMode } from "@/modules/research-reports/qa/service"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { createServerTickerKnowledgeIndex } from "@/modules/ticker-knowledge/server"

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

function resolveRetrievalMode(): ResearchReportQaRetrievalMode {
  const raw = (process.env.RESEARCH_REPORT_QA_RETRIEVAL_MODE ?? "shadow").trim().toLowerCase()
  if (raw === "lexical" || raw === "hybrid") return raw
  return "shadow"
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

  const retrievalMode = resolveRetrievalMode()
  let retrieveHybridEvidence: Parameters<typeof answerResearchReportQuestion>[2]["retrieveHybridEvidence"]
  if (retrievalMode !== "lexical") {
    try {
      const index = createServerTickerKnowledgeIndex()
      retrieveHybridEvidence = (qaClient, identity, query) =>
        retrieveResearchReportQaHybridEvidence(index, qaClient, identity, query)
    } catch {
      retrieveHybridEvidence = undefined
    }
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
      {
        retrievalMode,
        retrieveHybridEvidence,
        recordRetrievalComparison: retrievalMode === "lexical"
          ? undefined
          : (metric) => {
              console.info("[QEO-116_REPORT_QA_RETRIEVAL]", JSON.stringify({ reportId: id, ...metric }))
            },
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
