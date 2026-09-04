import { cookies } from "next/headers"
import { discoverFinhayOAuth, refreshFinhayToken, type FinhayTokenSet } from "@/modules/market/providers/finhay/live"

// Keep legacy cookie names so existing authenticated sessions survive the product rebrand.
const ACCESS = "stockos_finhay_access"
const REFRESH = "stockos_finhay_refresh"
const EXPIRES = "stockos_finhay_expires"
const CLIENT_ID = "stockos_finhay_client_id"
const CLIENT_SECRET = "stockos_finhay_client_secret"
const STATE = "stockos_finhay_state"
const VERIFIER = "stockos_finhay_verifier"

function secureCookie(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  }
}

export async function setFinhayOAuthAttempt(args: {
  state: string
  verifier: string
  clientId: string
  clientSecret?: string
}) {
  const store = await cookies()
  store.set(STATE, args.state, secureCookie(10 * 60))
  store.set(VERIFIER, args.verifier, secureCookie(10 * 60))
  store.set(CLIENT_ID, args.clientId, secureCookie(365 * 24 * 60 * 60))
  if (args.clientSecret) store.set(CLIENT_SECRET, args.clientSecret, secureCookie(365 * 24 * 60 * 60))
}

export async function getFinhayOAuthAttempt() {
  const store = await cookies()
  return {
    state: store.get(STATE)?.value ?? "",
    verifier: store.get(VERIFIER)?.value ?? "",
    clientId: store.get(CLIENT_ID)?.value ?? process.env.FINHAY_OAUTH_CLIENT_ID ?? "",
    clientSecret: store.get(CLIENT_SECRET)?.value ?? process.env.FINHAY_OAUTH_CLIENT_SECRET ?? "",
  }
}

export async function clearFinhayOAuthAttempt() {
  const store = await cookies()
  store.delete(STATE)
  store.delete(VERIFIER)
}

export async function setFinhayTokens(tokens: FinhayTokenSet) {
  const store = await cookies()
  const accessMaxAge = Math.max(60, tokens.expiresIn ?? 3600)
  store.set(ACCESS, tokens.accessToken, secureCookie(accessMaxAge))
  store.set(EXPIRES, String(Date.now() + accessMaxAge * 1000), secureCookie(accessMaxAge))
  if (tokens.refreshToken) store.set(REFRESH, tokens.refreshToken, secureCookie(90 * 24 * 60 * 60))
}

export async function clearFinhaySession() {
  const store = await cookies()
  for (const name of [ACCESS, REFRESH, EXPIRES, CLIENT_ID, CLIENT_SECRET, STATE, VERIFIER]) store.delete(name)
}

export async function getActiveFinhayAccessToken() {
  const store = await cookies()
  const accessToken = store.get(ACCESS)?.value ?? ""
  const expiresAt = Number(store.get(EXPIRES)?.value ?? 0)
  if (accessToken && (!expiresAt || expiresAt - Date.now() > 60_000)) return accessToken

  const refreshToken = store.get(REFRESH)?.value ?? ""
  const clientId = store.get(CLIENT_ID)?.value ?? process.env.FINHAY_OAUTH_CLIENT_ID ?? ""
  const clientSecret = store.get(CLIENT_SECRET)?.value ?? process.env.FINHAY_OAUTH_CLIENT_SECRET ?? ""
  if (!refreshToken || !clientId) return ""

  try {
    const metadata = await discoverFinhayOAuth()
    const refreshed = await refreshFinhayToken({ metadata, refreshToken, clientId, clientSecret: clientSecret || undefined })
    await setFinhayTokens(refreshed)
    return refreshed.accessToken
  } catch (error) {
    console.error("[QeoIndex Finhay] token refresh failed", error)
    return ""
  }
}
