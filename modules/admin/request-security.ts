import { validateMutationOrigin } from "@/modules/auth/request-security"

export function validateChangeReason(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.length > 240) return null
  return trimmed
}

export function validateAdminMutationRequest(
  request: Request,
  options?: { appUrl?: string },
): { ok: true } | { ok: false; status: number; error: string } {
  return validateMutationOrigin(request, options)
}
