import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

type MachineAuthOptions = {
  allowUnconfiguredInDevelopment?: boolean
}

function digest(value: string) {
  return createHash("sha256").update(value).digest()
}

function secureEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right))
}

export function isMachineRequestAuthorized(
  request: Request,
  secrets: Array<string | null | undefined>,
  options: MachineAuthOptions = {},
) {
  const configured = secrets
    .map((secret) => secret?.trim() ?? "")
    .filter((secret): secret is string => secret.length > 0)

  if (!configured.length) {
    return Boolean(options.allowUnconfiguredInDevelopment && process.env.NODE_ENV !== "production")
  }

  const authorization = request.headers.get("authorization") ?? ""
  if (!authorization.startsWith("Bearer ")) return false

  const candidate = authorization.slice("Bearer ".length)
  if (!candidate) return false

  return configured.some((secret) => secureEqual(candidate, secret))
}
