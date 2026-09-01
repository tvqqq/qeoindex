import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"
import { getCanonicalUniverse } from "@/lib/market-universe"

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const canonical = await getCanonicalUniverse()
  return NextResponse.json(
    {
      ok: true,
      runId: canonical.runId,
      selectedCount: canonical.selectedCount,
      sourceAsOfDate: canonical.sourceAsOfDate,
      updatedAt: canonical.updatedAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
