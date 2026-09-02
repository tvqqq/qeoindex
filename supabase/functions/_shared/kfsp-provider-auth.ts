import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

export interface KfspProviderAuthOptions {
  loginUrl: string
  timeoutMs: number
  tokenExpirySkewMs?: number
  persistLogin?: boolean
}

export interface KfspProviderAuthResult {
  token: string
  refreshed: boolean
}

const DEFAULT_TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1_000

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null
}

function decodeTokenExpiry(token: string): Date | null {
  try {
    const payload = token.split(".")[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")
    const parsed = JSON.parse(atob(normalized))
    return Number.isFinite(Number(parsed.exp)) ? new Date(Number(parsed.exp) * 1_000) : null
  } catch {
    return null
  }
}

function extractToken(payload: unknown): string | null {
  const root = asObject(payload)
  const data = asObject(root?.data)
  const candidates = [root?.token, root?.access_token, data?.token, data?.access_token]
  const token = candidates.find((value) => typeof value === "string" && value.split(".").length === 3)
  return typeof token === "string" ? token : null
}

async function loadCredentials(supabase: SupabaseClient) {
  const envUsername = Deno.env.get("KFSP_USERNAME") || ""
  const envPassword = Deno.env.get("KFSP_PASSWORD") || ""
  if (envUsername && envPassword) return { username: envUsername, password: envPassword }

  const vault = await supabase.rpc("qeo_get_kfsp_credentials")
  if (vault.error) throw new Error("KFSP_VAULT_CREDENTIALS_READ_FAILED")
  const payload = asObject(vault.data)
  const username = typeof payload?.username === "string" ? payload.username.trim() : ""
  const password = typeof payload?.password === "string" ? payload.password : ""
  if (!username || !password) throw new Error("KFSP_CREDENTIALS_MISSING")
  return { username, password }
}

async function loadCachedToken(supabase: SupabaseClient, expirySkewMs: number) {
  const cached = await supabase.rpc("qeo_get_kfsp_provider_token_cache")
  if (cached.error) throw new Error("KFSP_VAULT_TOKEN_CACHE_READ_FAILED")
  const payload = asObject(cached.data)
  const token = typeof payload?.access_token === "string" ? payload.access_token : ""
  const expiresAt = typeof payload?.expires_at === "string" ? new Date(payload.expires_at).getTime() : Number.NaN
  if (!token || token.split(".").length !== 3 || !Number.isFinite(expiresAt) || expiresAt - Date.now() <= expirySkewMs) return null
  return token
}

async function loginAndCacheToken(supabase: SupabaseClient, options: KfspProviderAuthOptions) {
  const credentials = await loadCredentials(supabase)
  const response = await fetch(options.loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      username: credentials.username,
      password: credentials.password,
      persist_login: options.persistLogin ?? false,
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`KFSP_LOGIN_HTTP_${response.status}`)

  const token = extractToken(payload)
  const expiresAt = token ? decodeTokenExpiry(token) : null
  if (!token || !expiresAt) throw new Error("KFSP_LOGIN_TOKEN_INVALID")

  const write = await supabase.rpc("qeo_set_kfsp_provider_token_cache", {
    p_access_token: token,
    p_expires_at: expiresAt.toISOString(),
  })
  if (write.error) throw new Error("KFSP_VAULT_TOKEN_CACHE_WRITE_FAILED")
  return token
}

export async function getKfspProviderToken(
  supabase: SupabaseClient,
  options: KfspProviderAuthOptions,
  forceRefresh = false,
): Promise<KfspProviderAuthResult> {
  if (!forceRefresh) {
    const cached = await loadCachedToken(supabase, options.tokenExpirySkewMs ?? DEFAULT_TOKEN_EXPIRY_SKEW_MS)
    if (cached) return { token: cached, refreshed: false }
  }
  return { token: await loginAndCacheToken(supabase, options), refreshed: true }
}
