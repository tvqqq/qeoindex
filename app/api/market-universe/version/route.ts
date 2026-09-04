import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { getCanonicalUniverseVersion } from "@/modules/market/universe/index"

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const canonical = await getCanonicalUniverseVersion()
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
