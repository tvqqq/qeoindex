import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"

export const AUTH_COOKIE_NAME = "qeoindex_access_token"

export type ServerAuthContext = {
  user: User
  supabase: SupabaseClient
  accessToken: string
}

function getPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function isServerAuthConfigured() {
  return Boolean(getPublicSupabaseConfig())
}

export function createUserScopedSupabaseClient(accessToken: string): SupabaseClient | null {
  const config = getPublicSupabaseConfig()
  if (!config) return null

  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<ServerAuthContext | null> {
  if (!accessToken) return null
  const supabase = createUserScopedSupabaseClient(accessToken)
  if (!supabase) return null

  const { data, error } = await supabase.auth.getUser(accessToken)
  if (error || !data.user) return null

  return { user: data.user, supabase, accessToken }
}

export const getServerAuthContext = cache(async (): Promise<ServerAuthContext | null> => {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? ""
  return verifySupabaseAccessToken(accessToken)
})

function authUnavailableResponse() {
  return NextResponse.json(
    { ok: false, error: "Supabase Auth is not configured." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  )
}

function unauthorizedResponse() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  )
}

export async function requireApiUser(): Promise<
  | { ok: true; context: ServerAuthContext }
  | { ok: false; response: NextResponse }
> {
  if (!isServerAuthConfigured()) {
    return { ok: false, response: authUnavailableResponse() }
  }

  const context = await getServerAuthContext()
  if (!context) {
    return { ok: false, response: unauthorizedResponse() }
  }

  return { ok: true, context }
}

export async function requireApiFeature(featureKey: string): Promise<
  | { ok: true; context: ServerAuthContext }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireApiUser()
  if (!auth.ok) return auth

  const { data, error } = await auth.context.supabase
    .from("user_features")
    .select("enabled")
    .eq("user_id", auth.context.user.id)
    .eq("feature_key", featureKey)
    .maybeSingle()

  if (error) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unable to verify feature access." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      ),
    }
  }

  if (!data?.enabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Feature not enabled.", feature: featureKey },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      ),
    }
  }

  return auth
}
