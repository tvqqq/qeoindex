import { NextResponse } from "next/server"

import { requireApiUser } from "@/lib/auth/server"
import { getSlackOpsHealth } from "@/lib/ops-alerts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json(await getSlackOpsHealth())
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 503 })
  }
}
