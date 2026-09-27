import { NextResponse } from "next/server"

import { validateAdminMutationRequest } from "@/modules/admin/request-security"
import { requireApiRoot } from "@/modules/auth/root"
import {
  buildResearchReportAdminDiagnostic,
  sanitizeResearchReportAdminError,
} from "@/modules/research-reports/admin-analysis"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const NO_STORE = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_AI_REQUEST_ATTEMPTS = 4
const MAX_AI_COST_USD = 1

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

async function loadReportRow(reportId: string) {
  const service = getSupabaseServerClient()
  if (!service) return { service: null, row: null, error: "Research report service unavailable" }

  const result = await service
    .from("market_research_reports")
    .select("id,pdf_url,analysis_status,analysis_error,ingestion_status,ingestion_error")
    .eq("id", reportId)
    .maybeSingle()

  if (result.error) {
    return {
      service,
      row: null,
      error: sanitizeResearchReportAdminError(result.error.message) || "Research report lookup failed",
    }
  }
  return { service, row: result.data as Record<string, unknown> | null, error: null }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const { id } = await params
  if (!UUID_RE.test(id)) return json({ ok: false, error: "Invalid report id" }, 400)

  const loaded = await loadReportRow(id)
  if (!loaded.service) return json({ ok: false, error: loaded.error }, 503)
  if (loaded.error) return json({ ok: false, error: loaded.error }, 500)
  if (!loaded.row) return json({ ok: false, error: "Report not found" }, 404)

  return json({
    ok: true,
    diagnostic: buildResearchReportAdminDiagnostic(loaded.row),
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const originValidation = validateAdminMutationRequest(request)
  if (!originValidation.ok) {
    return json({ ok: false, error: originValidation.error }, originValidation.status)
  }

  const { id } = await params
  if (!UUID_RE.test(id)) return json({ ok: false, error: "Invalid report id" }, 400)

  const loaded = await loadReportRow(id)
  if (!loaded.service) return json({ ok: false, error: loaded.error }, 503)
  if (loaded.error) return json({ ok: false, error: loaded.error }, 500)
  if (!loaded.row) return json({ ok: false, error: "Report not found" }, 404)

  const diagnostic = buildResearchReportAdminDiagnostic(loaded.row)
  if (!diagnostic.retryable) {
    return json({
      ok: false,
      error: diagnostic.retryBlockedReason || "Research report analysis cannot be retried now",
      diagnostic,
    }, 409)
  }

  const pdfUrl = typeof loaded.row.pdf_url === "string" ? loaded.row.pdf_url.trim() : ""

  try {
    const [{ createResearchReportAiBudget }, { processResearchReport }] = await Promise.all([
      import("@/modules/research-reports/analysis/budget"),
      import("@/modules/research-reports/analysis/pipeline"),
    ])
    const budget = createResearchReportAiBudget({
      maxRequestAttempts: MAX_AI_REQUEST_ATTEMPTS,
      maxEstimatedCostUsd: MAX_AI_COST_USD,
    })

    const result = await processResearchReport(
      loaded.service as unknown as Parameters<typeof processResearchReport>[0],
      { id, pdfUrl },
      { aiBudget: budget },
    )

    if (result.status === "failed") {
      return json({
        ok: false,
        error: result.detail,
        status: result.status,
        budget: budget.snapshot(),
      }, 502)
    }

    if (result.status === "needs_ocr" || result.status === "unsupported") {
      return json({
        ok: false,
        error: result.detail,
        status: result.status,
        budget: budget.snapshot(),
      }, 409)
    }

    return json({
      ok: true,
      status: result.status,
      analysisId: result.analysisId,
      aiCalled: result.aiCalled,
      detail: result.detail,
      budget: budget.snapshot(),
    })
  } catch (error) {
    return json({
      ok: false,
      error: sanitizeResearchReportAdminError(error instanceof Error ? error.message : String(error))
        || "Research report analysis retry failed",
    }, 500)
  }
}
