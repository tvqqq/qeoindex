import { NextResponse } from "next/server"

import { isConfiguredRootUserId } from "@/lib/auth/root"
import { requireApiUser, type ServerAuthContext } from "@/lib/auth/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" }
const DEFAULT_PAGES = new Set(["board", "research", "signals", "scanner", "fa"])
const MAX_SETTINGS_BYTES = 16 * 1024

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function accountServerError(operation: string, error: unknown) {
  console.error(`[QeoIndex Account] ${operation} failed`, error)
  return NextResponse.json(
    { ok: false, error: "Account request failed." },
    { status: 500, headers: NO_STORE_HEADERS },
  )
}

async function loadAccount(context: ServerAuthContext) {
  const userId = context.user.id
  const [profileResult, preferencesResult, featuresResult] = await Promise.all([
    context.supabase.from("profiles").select("id,display_name,avatar_url,created_at,updated_at").eq("id", userId).maybeSingle(),
    context.supabase.from("user_preferences").select("user_id,default_page,compact_board,sound_enabled,settings,created_at,updated_at").eq("user_id", userId).maybeSingle(),
    context.supabase.from("user_features").select("feature_key,enabled,config,updated_at").eq("user_id", userId).order("feature_key"),
  ])

  const firstError = profileResult.error ?? preferencesResult.error ?? featuresResult.error
  if (firstError) throw firstError

  return {
    user: { id: context.user.id, email: context.user.email ?? null },
    isRoot: isConfiguredRootUserId(context.user.id),
    profile: profileResult.data,
    preferences: preferencesResult.data,
    features: Object.fromEntries((featuresResult.data ?? []).map((row) => [row.feature_key, {
      enabled: row.enabled,
      config: row.config,
      updatedAt: row.updated_at,
    }])),
  }
}

export async function GET() {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  try {
    return NextResponse.json({ ok: true, ...(await loadAccount(auth.context)) }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return accountServerError("load", error)
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser()
  if (!auth.ok) return auth.response

  const body = await request.json().catch(() => null)
  if (!isPlainObject(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400, headers: NO_STORE_HEADERS })
  }

  const userId = auth.context.user.id
  let changed = false

  try {
    if (Object.prototype.hasOwnProperty.call(body, "displayName")) {
      const displayName = body.displayName == null ? null : String(body.displayName).trim()
      if (displayName && displayName.length > 80) {
        return NextResponse.json({ ok: false, error: "displayName is too long." }, { status: 400, headers: NO_STORE_HEADERS })
      }
      const { error } = await auth.context.supabase.from("profiles").upsert({ id: userId, display_name: displayName || null }, { onConflict: "id" })
      if (error) throw error
      changed = true
    }

    const preferencePatch: Record<string, unknown> = { user_id: userId }
    let preferenceChanged = false

    if (Object.prototype.hasOwnProperty.call(body, "defaultPage")) {
      const defaultPage = String(body.defaultPage ?? "")
      if (!DEFAULT_PAGES.has(defaultPage)) {
        return NextResponse.json({ ok: false, error: "Unsupported defaultPage." }, { status: 400, headers: NO_STORE_HEADERS })
      }
      preferencePatch.default_page = defaultPage
      preferenceChanged = true
    }
    if (Object.prototype.hasOwnProperty.call(body, "compactBoard")) {
      if (typeof body.compactBoard !== "boolean") {
        return NextResponse.json({ ok: false, error: "compactBoard must be boolean." }, { status: 400, headers: NO_STORE_HEADERS })
      }
      preferencePatch.compact_board = body.compactBoard
      preferenceChanged = true
    }
    if (Object.prototype.hasOwnProperty.call(body, "soundEnabled")) {
      if (typeof body.soundEnabled !== "boolean") {
        return NextResponse.json({ ok: false, error: "soundEnabled must be boolean." }, { status: 400, headers: NO_STORE_HEADERS })
      }
      preferencePatch.sound_enabled = body.soundEnabled
      preferenceChanged = true
    }
    if (Object.prototype.hasOwnProperty.call(body, "settings")) {
      if (!isPlainObject(body.settings)) {
        return NextResponse.json({ ok: false, error: "settings must be an object." }, { status: 400, headers: NO_STORE_HEADERS })
      }
      const encodedSettings = JSON.stringify(body.settings)
      if (Buffer.byteLength(encodedSettings, "utf8") > MAX_SETTINGS_BYTES) {
        return NextResponse.json({ ok: false, error: "settings payload is too large." }, { status: 400, headers: NO_STORE_HEADERS })
      }
      preferencePatch.settings = body.settings
      preferenceChanged = true
    }

    if (preferenceChanged) {
      const { error } = await auth.context.supabase.from("user_preferences").upsert(preferencePatch, { onConflict: "user_id" })
      if (error) throw error
      changed = true
    }

    if (!changed) {
      return NextResponse.json({ ok: false, error: "No supported fields to update." }, { status: 400, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json({ ok: true, ...(await loadAccount(auth.context)) }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return accountServerError("update", error)
  }
}
