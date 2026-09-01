import { NextResponse } from "next/server"

import { dispatchManualAdminJob } from "@/lib/admin/jobs"
import { validateAdminMutationRequest } from "@/lib/admin/request-security"
import { requireApiRoot } from "@/lib/auth/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

type ManualJobApiParams = {
  limit?: number
  offset?: number
  tickers?: string[]
  force?: boolean
}

export async function POST(
  request: Request,
  props: { params: Promise<{ key: string }> },
) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const originValidation = validateAdminMutationRequest(request)
  if (!originValidation.ok) {
    return NextResponse.json(
      { ok: false, error: originValidation.error },
      { status: originValidation.status, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  }

  const { key } = await props.params
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Key tác vụ không hợp lệ" },
      { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  }

  try {
    let body: Record<string, unknown> = {}
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      body = {}
    }

    const { reason, confirmed, params } = body ?? {}
    const requestId = crypto.randomUUID()
    const normalizedParams = params && typeof params === "object"
      ? params as ManualJobApiParams
      : undefined

    const result = await dispatchManualAdminJob({
      key,
      actorUserId: auth.context.user.id,
      reason: String(reason || ""),
      requestId,
      confirmed: confirmed === true,
      params: normalizedParams,
    })

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "Thực thi tác vụ thất bại" },
        { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
      )
    }

    return NextResponse.json(
      { ok: true, result },
      {
        status: result.summary?.queued === true ? 202 : 200,
        headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" },
      },
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Malformed request" },
      { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  }
}
