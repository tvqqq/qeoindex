import { NextResponse } from "next/server"

import { requireApiUser } from "@/modules/auth/server"
import {
  createDisciplineProfileAttempt,
  listDisciplineProfileAttempts,
} from "@/modules/portfolio/risk-plan/server"
import { RiskPlanDomainError } from "@/modules/portfolio/risk-plan/validation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }

function failure(error: unknown) {
  if (error instanceof RiskPlanDomainError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status, headers: NO_STORE })
  }
  console.error("[Portfolio Risk Plan] discipline-profile request failed", error)
  return NextResponse.json({ ok: false, error: "Discipline Profile request failed." }, { status: 500, headers: NO_STORE })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response
  const { id } = await params

  try {
    const attempts = await listDisciplineProfileAttempts(auth.context, id)
    return NextResponse.json({ ok: true, attempts }, { headers: NO_STORE })
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
    const attempt = await createDisciplineProfileAttempt(auth.context, id, body)
    return NextResponse.json({ ok: true, attempt }, { status: 201, headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
