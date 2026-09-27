import { NextResponse } from "next/server"

import { validateAdminMutationRequest } from "@/modules/admin/request-security"
import { requireApiRoot } from "@/modules/auth/root"
import { getResearchReportDetail } from "@/modules/research-reports"
import { generateResearchReportSummaryImage } from "@/modules/research-reports/summary-image"
import { normalizeResearchReportSummaryImageSettings } from "@/modules/research-reports/summary-image-settings"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const originValidation = validateAdminMutationRequest(request)
  if (!originValidation.ok) {
    return NextResponse.json(
      { ok: false, error: originValidation.error },
      { status: originValidation.status },
    )
  }

  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }

  let settings
  try {
    settings = normalizeResearchReportSummaryImageSettings(body.settings)
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid image settings" },
      { status: 400 },
    )
  }

  const service = getSupabaseServerClient()
  if (!service) {
    return NextResponse.json({ ok: false, error: "Summary image service unavailable" }, { status: 503 })
  }

  const { id } = await params
  const detail = await getResearchReportDetail(
    service as unknown as Parameters<typeof getResearchReportDetail>[0],
    id,
  )
  if (detail.status === "invalid_id") {
    return NextResponse.json({ ok: false, error: "Invalid report id" }, { status: 400 })
  }
  if (detail.status === "not_found") {
    return NextResponse.json({ ok: false, error: "Report not found" }, { status: 404 })
  }
  if (detail.report.analysisStatus !== "ready" || !detail.report.analysis?.analysisId) {
    return NextResponse.json(
      { ok: false, error: "Current report analysis is not ready for image generation" },
      { status: 409 },
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
    return NextResponse.json(
      {
        ok: false,
        error: result.detail,
        preservedExistingImage: Boolean(result.path),
      },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    regenerated: result.status === "ready",
  })
}
