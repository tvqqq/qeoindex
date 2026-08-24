import "server-only"

import { NextResponse } from "next/server"
import { getServerAuthContext, requireApiUser, type ServerAuthContext } from "@/lib/auth/server"
import { isRootAdminUserId } from "@/lib/auth/root-id"

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" }

export function isConfiguredRootUserId(userId: string): boolean {
  return isRootAdminUserId(userId, process.env.ROOT_ADMIN_USER_IDS)
}

export async function getRootPageContext(): Promise<ServerAuthContext | null> {
  const context = await getServerAuthContext()
  return context && isConfiguredRootUserId(context.user.id) ? context : null
}

export async function requireApiRoot(): Promise<
  | { ok: true; context: ServerAuthContext }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireApiUser()
  if (!auth.ok) return auth
  if (!isConfiguredRootUserId(auth.context.user.id)) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: NO_STORE }),
    }
  }
  return auth
}
