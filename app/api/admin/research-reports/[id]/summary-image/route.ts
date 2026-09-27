import { NextResponse } from "next/server"

import { validateAdminMutationRequest } from "@/modules/admin/request-security"
import { requireApiRoot } from "@/modules/auth/root"
import { getResearchReportDetail } from "@/modules/research-reports"
import { generateResearchReportSummaryImage } from "@/modules/research-reports/summary-image"
import { normalizeResearchReportSummaryImageSettings } from "@/modules/research-reports/summary-image-settings"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" }

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
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

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400)
  }

  let settings
  try {
    settings = normalizeResearchReportSummaryImageSettings(body.settings)
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid image settings" },
      400,
    )
  }

  const service = getSupabaseServerClient()
  if (!service) {
    return json({ ok: false, error: "Summary image service unavailable" }, 503)
  }

  const { id } = await params
  const detail = await getResearchReportDetail(
    service as unknown as Parameters<typeof getResearchReportDetail>[0],
    id,
  )
  if (detail.status === "invalid_id") {
    return json({ ok: false, error: "Invalid report id" }, 400)
  }
  if (detail.status === "not_found") {
    return json({ ok: false, error: "Report not found" }, 404)
  }
  if (detail.report.analysisStatus !== "ready" || !detail.report.analysis?.analysisId) {
    return json(
      { ok: false, error: "Current report analysis is not ready for image generation" },
      409,
    )
  }

  const result = await generateResearchReportSummaryImage(
    service as unknown as Parameters<typeof generateResearchReportSummaryImage>[0],
    {
      reportId: detail.report.id,
      analysisId: detail.report.analysis.analysisId,
      force: true,
      settings,
    },
  )

  if (result.status === "failed") {
    return json(
      {
        ok: false,
        error: result.detail,
        preservedExistingImage: Boolean(result.path),
      },
      502,
    )
  }

  return json({
    ok: true,
    status: result.status,
    regenerated: result.status === "ready",
  })
}
