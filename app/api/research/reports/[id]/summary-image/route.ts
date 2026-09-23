import { NextResponse } from "next/server"

import { getServerAuthContext } from "@/modules/auth/server"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"

const IMAGE_BUCKET = "research-report-images"
const NO_STORE_HEADERS = { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" }

function contentType(path: string, fallback: string | null): string {
  if (fallback?.startsWith("image/")) return fallback
  if (path.endsWith(".webp")) return "image/webp"
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  return "image/png"
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getServerAuthContext()
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const result = await (auth.supabase as any)
    .from("market_research_reports")
    .select("summary_image_status,summary_image_path")
    .eq("id", id)
    .maybeSingle()

  if (result.error || !result.data || result.data.summary_image_status !== "ready" || !result.data.summary_image_path) {
    return NextResponse.json({ error: "Summary image not available" }, { status: 404 })
  }

  const service = getSupabaseServerClient()
  if (!service) {
    return NextResponse.json({ error: "Storage unavailable" }, { status: 503 })
  }

  const path = String(result.data.summary_image_path)
  const download = await service.storage.from(IMAGE_BUCKET).download(path)
  if (download.error || !download.data) {
    return NextResponse.json({ error: "Summary image not found" }, { status: 404 })
  }

  return new Response(await download.data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": contentType(path, download.data.type || null),
      ...NO_STORE_HEADERS,
    },
  })
}
