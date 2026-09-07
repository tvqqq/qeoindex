import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { getRiskPlanOverview } from "@/modules/portfolio/risk-plan/server"
import { RiskPlanDomainError } from "@/modules/portfolio/risk-plan/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

function failure(error: unknown) {
  if (error instanceof RiskPlanDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Risk Plan] overview request failed", error)
  return NextResponse.json({ ok: false, error: "Risk plan request failed." }, { status: 500, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params

  try {
    const overview = await getRiskPlanOverview(auth.context, id)
    return NextResponse.json({ ok: true, overview }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
