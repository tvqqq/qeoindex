import { NextResponse } from "next/server"

import { validateAdminMutationRequest } from "@/modules/admin/request-security"
import { loadAdminSettingsSnapshot, setAdminSetting } from "@/modules/admin/settings"
import { requireApiRoot } from "@/modules/auth/root"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const snapshot = await loadAdminSettingsSnapshot()
  return NextResponse.json(
    { ok: true, snapshot },
    {
      headers: {
        "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
      },
    },
  )
}

export async function POST(request: Request) {
  const auth = await requireApiRoot()
  if (!auth.ok) return auth.response

  const originValidation = validateAdminMutationRequest(request)
  if (!originValidation.ok) {
    return NextResponse.json(
      { ok: false, error: originValidation.error },
      { status: originValidation.status, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  }

  try {
    const body = await request.json()
    const { key, value, expectedVersion, reason } = body ?? {}

    if (!key || typeof key !== "string") {
      return NextResponse.json(
        { ok: false, error: "Key cài đặt không hợp lệ" },
        { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
      )
    }

    const version = typeof expectedVersion === "number" ? expectedVersion : Number(expectedVersion) || 1
    const requestId = crypto.randomUUID()

    const result = await setAdminSetting({
      key,
      value,
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
        { ok: false, error: result.error || "Không thể lưu cài đặt" },
        { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
      )
    }

    const snapshot = await loadAdminSettingsSnapshot()
    return NextResponse.json(
      { ok: true, record: result.record, snapshot },
      { headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Malformed request" },
      { status: 400, headers: { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate" } },
    )
  }
}
