import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import { getPortfolioPerformanceContext } from "@/modules/portfolio/performance/server"
import { RiskPlanDomainError } from "@/modules/portfolio/risk-plan/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
}

function failure(error: unknown) {
  if (error instanceof RiskPlanDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status, headers: NO_STORE_HEADERS },
    )
  }
  console.error("[Portfolio Performance] request failed", error)
  return NextResponse.json(
    { ok: false, error: "Portfolio performance request failed." },
    { status: 500, headers: NO_STORE_HEADERS },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params

  try {
    const performance = await getPortfolioPerformanceContext(auth.context, id)
    return NextResponse.json({ ok: true, performance }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return failure(error)
  }
}
