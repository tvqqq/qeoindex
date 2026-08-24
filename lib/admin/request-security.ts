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
  const origin = request.headers.get("origin")
  if (!origin) {
    return { ok: false, status: 403, error: "Missing origin header" }
  }

  const allowedOrigins = new Set<string>()

  if (options?.appUrl) {
    try {
      allowedOrigins.add(new URL(options.appUrl).origin)
    } catch {
      // ignore malformed custom url
    }
  }

  const configuredAppUrl = process.env.APP_URL
  if (configuredAppUrl) {
    try {
      allowedOrigins.add(new URL(configuredAppUrl).origin)
    } catch {
      // ignore
    }
  }

  const nextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL
  if (nextPublicAppUrl) {
    try {
      allowedOrigins.add(new URL(nextPublicAppUrl).origin)
    } catch {
      // ignore
    }
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    allowedOrigins.add(`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`)
  }

  if (process.env.VERCEL_URL) {
    allowedOrigins.add(`https://${process.env.VERCEL_URL}`)
  }

  const isProduction = process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production"
  if (!isProduction) {
    allowedOrigins.add("http://localhost:3000")
    allowedOrigins.add("http://127.0.0.1:3000")
  }

  let requestOrigin: string
  try {
    requestOrigin = new URL(origin).origin
  } catch {
    return { ok: false, status: 403, error: "Invalid origin header" }
  }

  if (allowedOrigins.has(requestOrigin)) {
    return { ok: true }
  }

  return { ok: false, status: 403, error: "Cross-origin mutation request rejected" }
}
