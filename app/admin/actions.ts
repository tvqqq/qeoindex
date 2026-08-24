"use server"

import { revalidatePath } from "next/cache"

import { dispatchManualAdminJob } from "@/lib/admin/jobs"
import { resetAdminSetting, setAdminSetting } from "@/lib/admin/settings"
import { getRootPageContext } from "@/lib/auth/root"

export interface AdminActionResult {
  ok: boolean
  message?: string
  error?: string
  conflict?: boolean
  record?: unknown
  summary?: unknown
}

export async function saveSettingAction(
  _prevState: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  const context = await getRootPageContext()
  if (!context?.user?.id) {
    return { ok: false, error: "Bạn không có quyền thực hiện thay đổi này (Root Admin only)." }
  }

  const key = String(formData.get("key") || "").trim()
  const rawValue = formData.get("value")
  const expectedVersion = Number(formData.get("expectedVersion")) || 1
  const reason = String(formData.get("reason") || "").trim()

  if (!key) {
    return { ok: false, error: "Key cài đặt không được để trống." }
  }

  let value: unknown = rawValue
  const rawType = String(formData.get("type") || "")
  if (rawType === "boolean") {
    value = rawValue === "true" || rawValue === "1" || rawValue === "on"
  } else if (rawType === "integer" || rawType === "number") {
    value = Number(rawValue)
  } else if (rawType === "ticker_list") {
    if (typeof rawValue === "string") {
      value = rawValue.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    }
  }

  const requestId = crypto.randomUUID()
  const result = await setAdminSetting({
    key,
    value,
    expectedVersion,
    actorUserId: context.user.id,
    reason,
    requestId,
  })

  if (!result.ok) {
    if (result.conflict) {
      return {
        ok: false,
        conflict: true,
        error: "Xung đột phiên bản: Cài đặt đã được sửa đổi bởi thao tác khác. Vui lòng tải lại trang.",
      }
    }
    return { ok: false, error: result.error || "Không thể lưu cài đặt." }
  }

  revalidatePath("/admin")
  return { ok: true, message: `Đã lưu cài đặt ${key} thành công.`, record: result.record }
}

export async function resetSettingAction(
  _prevState: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  const context = await getRootPageContext()
  if (!context?.user?.id) {
    return { ok: false, error: "Bạn không có quyền thực hiện thao tác này (Root Admin only)." }
  }

  const key = String(formData.get("key") || "").trim()
  const expectedVersion = Number(formData.get("expectedVersion")) || 1
  const reason = String(formData.get("reason") || "").trim()

  if (!key) {
    return { ok: false, error: "Key cài đặt không được để trống." }
  }

  const requestId = crypto.randomUUID()
  const result = await resetAdminSetting({
    key,
    expectedVersion,
    actorUserId: context.user.id,
    reason,
    requestId,
  })

  if (!result.ok) {
    if (result.conflict) {
      return {
        ok: false,
        conflict: true,
        error: "Xung đột phiên bản: Cài đặt đã được sửa đổi bởi thao tác khác. Vui lòng tải lại trang.",
      }
    }
    return { ok: false, error: result.error || "Không thể khôi phục cài đặt." }
  }

  revalidatePath("/admin")
  return { ok: true, message: `Đã khôi phục cài đặt ${key} về mặc định.` }
}

export async function runJobAction(
  _prevState: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  const context = await getRootPageContext()
  if (!context?.user?.id) {
    return { ok: false, error: "Bạn không có quyền thực hiện thao tác này (Root Admin only)." }
  }

  const key = String(formData.get("key") || "").trim()
  const reason = String(formData.get("reason") || "").trim()

  if (!key) {
    return { ok: false, error: "Key tác vụ không được để trống." }
  }

  const requestId = crypto.randomUUID()
  const result = await dispatchManualAdminJob({
    key,
    actorUserId: context.user.id,
    reason,
    requestId,
  })

  if (!result.ok) {
    return { ok: false, error: result.error || "Thực thi tác vụ thất bại." }
  }

  revalidatePath("/admin")
  return {
    ok: true,
    message: `Đã thực thi tác vụ ${key} thành công (${result.durationMs}ms).`,
    summary: result.summary,
  }
}
