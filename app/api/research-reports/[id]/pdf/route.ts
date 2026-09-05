import { requireApiFeature } from "@/modules/auth/server"
import { findResearchReportPdfSource } from "@/modules/research-reports/detail/repository"
import {
  safeResearchReportPdfBrowserUrl,
  validatePdfReportId,
} from "@/modules/research-reports/detail/pdf-route"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function jsonError(status: number, error: string) {
  return Response.json(
    { ok: false, error },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiFeature("research")
  if (!auth.ok) return auth.response

  const { id: rawId } = await params
  const validated = validatePdfReportId(rawId)
  if (!validated.ok) return jsonError(400, "Invalid research report id")

  const client = getSupabaseServerClient()
  if (!client) return jsonError(503, "Research report service is unavailable")

  let source: Awaited<ReturnType<typeof findResearchReportPdfSource>>
  try {
    source = await findResearchReportPdfSource(
      client as unknown as Parameters<typeof findResearchReportPdfSource>[0],
      validated.id,
    )
  } catch {
    return jsonError(503, "Research report service is unavailable")
  }

  if (!source) return jsonError(404, "Research report not found")

  const target = safeResearchReportPdfBrowserUrl(source.pdfUrl)
  if (!target) return jsonError(502, "Research report PDF is unavailable")

  return new Response(null, {
    status: 307,
    headers: {
      Location: target,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
