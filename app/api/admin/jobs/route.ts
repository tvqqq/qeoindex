import { NextResponse } from "next/server"

import { loadAdminJobHistory, loadAdminJobsSnapshot } from "@/modules/admin/job-health"
import { requireApiRoot } from "@/modules/auth/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const url = new URL(request.url)
  const jobKey = url.searchParams.get("key") || undefined
  const rawLimit = Number(url.searchParams.get("limit"))
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(100, rawLimit) : 50

  const [snapshot, history] = await Promise.all([
    loadAdminJobsSnapshot(),
    loadAdminJobHistory(jobKey, limit),
  ])

  return NextResponse.json(
    {
      ok: true,
      jobs: snapshot.jobs,
      counts: snapshot.counts,
      history,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      },
    },
  )
}
