import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import {
  createMoneyManagementPlanVersion,
  listMoneyManagementPlans,
} from "@/modules/portfolio/risk-plan/server"
import { RiskPlanDomainError } from "@/modules/portfolio/risk-plan/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

function failure(error: unknown) {
  if (error instanceof RiskPlanDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : error.code === "ADVANCED_RISK_ACK_REQUIRED" ? 409 : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Risk Plan] plan request failed", error)
  return NextResponse.json({ ok: false, error: "Money Management Plan request failed." }, { status: 500, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params

  try {
    const plans = await listMoneyManagementPlans(auth.context, id)
    return NextResponse.json({ ok: true, plans }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: false, error: "Request body không hợp lệ." }, { status: 400, headers: NO_STORE })

  try {
    const plan = await createMoneyManagementPlanVersion(auth.context, id, body)
    return NextResponse.json({ ok: true, plan }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
