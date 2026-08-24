import { NextResponse } from "next/server"

import { validateAdminMutationRequest } from "@/lib/admin/request-security"
import { loadAdminSettingsSnapshot, resetAdminSetting } from "@/lib/admin/settings"
import { requireApiRoot } from "@/lib/auth/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(
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
      { ok: false, error: "Key cài đặt không hợp lệ" },
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

    const { expectedVersion, reason } = body ?? {}
    const version = typeof expectedVersion === "number" ? expectedVersion : Number(expectedVersion) || 1
    const requestId = crypto.randomUUID()

    const result = await resetAdminSetting({
      key,
      expectedVersion: version,
      actorUserId: auth.context.user.id,
      reason: String(reason || ""),
      requestId,
    })

    if (!result.ok) {
      if (result.conflict) {
        return NextResponse.json(
          { ok: false, conflict: true, current: result.current, error: "Xung đột phiên bản: Cài đặt đã được sửa đổi bởi người khác." },
          { status: 409, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
        )
      }

      return NextResponse.json(
        { ok: false, error: result.error || "Không thể khôi phục cài đặt" },
        { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
      )
    }

    const snapshot = await loadAdminSettingsSnapshot()
    return NextResponse.json(
      { ok: true, snapshot },
      { headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Malformed request" },
      { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  }
}
