import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { io, type Socket } from "npm:socket.io-client@4.8.1"

import {
  parseVerifiedMarketClosePayloads,
  validateMarketCloseSnapshot,
  parseNumeric,
  type NormalizedIndexRow,
} from "../_shared/market-close-normalizer.ts"

const PROVIDER_TIMEOUT_MS = 8_000
const SOCKET_TIMEOUT_MS = 6_000
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1_000
const LOGIN_URL = Deno.env.get("KFSP_LOGIN_URL") || "https://api.kfsp.vn/api/login"
const MARKET_PULSE_URL = Deno.env.get("KFSP_MARKET_PULSE_URL") || "https://api.kfsp.vn/api/stocks/market_pulse/getContent?is_get_style=true&version=v3"
const CASH_FLOWS_URL = Deno.env.get("KFSP_CASH_FLOWS_URL") || "https://api2.kfsp.vn/api/stocks/dashboard/get-data-cash-flows?san=HOSE"
const TOP_VOLATILITY_URL = Deno.env.get("KFSP_TOP_VOLATILITY_URL") || "https://api.kfsp.vn/api/stocks/dashboard/get-list-mack-market-volatility?type=volume_desc&board=1&limit=10"
const CONTRACT_VERSION = 1

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function serviceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (legacy) return legacy
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS")
  if (!encoded) return ""
  try {
    return String(JSON.parse(encoded)?.default || "")
  } catch {
    return ""
  }
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let mismatch = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return mismatch === 0
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

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

async function loginAndCacheToken(supabase: SupabaseClient) {
  const username = Deno.env.get("KFSP_USERNAME") || ""
  const password = Deno.env.get("KFSP_PASSWORD") || ""
  if (!username || !password) throw new Error("PROVIDER_CREDENTIALS_MISSING")

  const { response, payload } = await fetchJson(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password, persist_login: true }),
  })
  if (!response.ok) throw new Error(`PROVIDER_LOGIN_HTTP_${response.status}`)

  const token = extractToken(payload)
  const expiresAt = token ? decodeTokenExpiry(token) : null
  if (!token || !expiresAt) throw new Error("PROVIDER_LOGIN_TOKEN_INVALID")

  const cache = await supabase.from("kfsp_provider_tokens").upsert({
    provider: "kfsp",
    access_token: token,
    expires_at: expiresAt.toISOString(),
    refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider" })
  if (cache.error) throw new Error("TOKEN_CACHE_WRITE_FAILED")
  return token
}

async function getProviderToken(supabase: SupabaseClient, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await supabase
      .from("kfsp_provider_tokens")
      .select("access_token,expires_at")
      .eq("provider", "kfsp")
      .maybeSingle()
    if (!cached.error && cached.data?.access_token && cached.data.expires_at) {
      const expiry = new Date(cached.data.expires_at).getTime()
      if (Number.isFinite(expiry) && expiry - Date.now() > TOKEN_EXPIRY_SKEW_MS) {
        return { token: String(cached.data.access_token), refreshed: false }
      }
    }
  }
  return { token: await loginAndCacheToken(supabase), refreshed: true }
}

function deriveSessionDate(isoString?: string): string {
  const date = isoString ? new Date(isoString) : new Date()
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(Number.isFinite(date.getTime()) ? date : new Date())
}

async function collectSocketData(token: string, topTickers: string[]): Promise<{
  maBreadth: unknown
  risk: unknown
  psychology: unknown
  sectorPulse: unknown
  sectorBreadth: unknown
  getLive: unknown
}> {
  return new Promise((resolve) => {
    let resolved = false
    const results = {
      maBreadth: null as unknown,
      risk: null as unknown,
      psychology: null as unknown,
      sectorPulse: null as unknown,
      sectorBreadth: null as unknown,
      getLive: null as unknown,
    }

    let socket: Socket | null = null

    const cleanupAndResolve = () => {
      if (!resolved) {
        resolved = true
        if (socket) {
          try {
            socket.disconnect()
          } catch {}
        }
        resolve(results)
      }
    }

    const timer = setTimeout(cleanupAndResolve, SOCKET_TIMEOUT_MS)

    try {
      socket = io("wss://ta.kfsp.vn:443/", {
        path: "/ws/socket.io",
        transports: ["polling", "websocket"],
        extraHeaders: { Authorization: `Bearer ${token}` },
        reconnection: false,
        timeout: SOCKET_TIMEOUT_MS,
      })

      socket.on("connect", () => {
        socket?.emit("getmarketpulsemabyindex", "VNINDEX", (res: unknown) => {
          results.maBreadth = res
        })

        socket?.emit("getdatariskindex", "VNINDEX", 1, (res: unknown) => {
          results.risk = res
        })

        socket?.emit("getpsychologyindicator", "VNINDEX", 1, (res: unknown) => {
          results.psychology = res
        })

        socket?.emit("getmarketpulse", "nganh", "1", (res: unknown) => {
          results.sectorPulse = res
          const sectorNames = (res as any)?.name
          if (Array.isArray(sectorNames) && sectorNames.length > 0) {
            socket?.emit("getincreasesdecreasesnganh", sectorNames, (bRes: unknown) => {
              results.sectorBreadth = bRes
            })
          }
        })

        if (topTickers.length > 0) {
          socket?.emit("getlive", topTickers, (res: unknown) => {
            results.getLive = res
          })
        }

        setTimeout(cleanupAndResolve, 3000)
      })

      socket.on("connect_error", cleanupAndResolve)
    } catch {
      cleanupAndResolve()
    }
  })
}

function validateCanonicalIndexesInput(input: unknown, sessionDate: string, asOfIso: string): NormalizedIndexRow[] | null {
  if (!Array.isArray(input) || input.length !== 4) return null
  const required = ["VNINDEX", "VN30", "HNX", "UPCOM"] as const
  const rows: NormalizedIndexRow[] = []

  for (const req of required) {
    const found = input.find((item) => asObject(item)?.index_code === req)
    const obj = asObject(found)
    if (!obj) return null
    const val = parseNumeric(obj.value)
    if (val == null || val <= 0) return null

    rows.push({
      session_date: sessionDate,
      index_code: req,
      value: val,
      change: parseNumeric(obj.change),
      change_pct: parseNumeric(obj.change_pct),
      reference: parseNumeric(obj.reference),
      open: parseNumeric(obj.open),
      high: parseNumeric(obj.high),
      low: parseNumeric(obj.low),
      matched_volume: parseNumeric(obj.matched_volume),
      traded_value: parseNumeric(obj.traded_value),
      previous_value_change_pct: parseNumeric(obj.previous_value_change_pct),
      advances: Math.max(0, Math.round(parseNumeric(obj.advances) ?? 0)),
      unchanged: Math.max(0, Math.round(parseNumeric(obj.unchanged) ?? 0)),
      declines: Math.max(0, Math.round(parseNumeric(obj.declines) ?? 0)),
      ceilings: Math.max(0, Math.round(parseNumeric(obj.ceilings) ?? 0)),
      floors: Math.max(0, Math.round(parseNumeric(obj.floors) ?? 0)),
      market_pe: parseNumeric(obj.market_pe),
      foreign_buy_value: parseNumeric(obj.foreign_buy_value),
      foreign_sell_value: parseNumeric(obj.foreign_sell_value),
      foreign_net_value: parseNumeric(obj.foreign_net_value),
      quality_status: "healthy",
      missing_fields: [],
      evidence_refs: Array.isArray(obj.evidence_refs) && obj.evidence_refs.length > 0
        ? obj.evidence_refs
        : [{ field: "value", source_class: "canonical_market_feed", observed_at: asOfIso, unit: "points" }],
      source_timestamp: typeof obj.source_timestamp === "string" ? obj.source_timestamp : asOfIso,
      as_of: asOfIso,
    })
  }

  return rows
}

async function fetchFallbackCanonicalIndexes(sessionDate: string, asOfIso: string): Promise<NormalizedIndexRow[]> {
  const codes = ["VNINDEX", "VN30", "HNX", "UPCOM"] as const
  const vpsRes = await fetch("https://bgapidatafeed.vps.com.vn/getlistindexdetail/10,11,02,03", {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(5_000),
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

  const vpsMap: Record<string, string> = { "10": "VNINDEX", "11": "VN30", "02": "HNX", "03": "UPCOM" }
  const resultMap = new Map<string, Record<string, unknown>>()

  if (Array.isArray(vpsRes)) {
    for (const item of vpsRes) {
      const code = vpsMap[String(item?.mc)]
      if (code) resultMap.set(code, item)
    }
  }

  return codes.map((code) => {
    const raw = resultMap.get(code)
    const val = raw?.cIndex != null ? Number(raw.cIndex) : null
    const open = raw?.oIndex != null ? Number(raw.oIndex) : null
    const ot = String(raw?.ot || "")
    let advances = 0
    let declines = 0
    let unchanged = 0
    let ceilings = 0
    let floors = 0

    if (ot) {
      const p = ot.split("|")
      if (p.length >= 6) {
        advances = Number(p[3]) || 0
        declines = Number(p[4]) || 0
        unchanged = Number(p[5]) || 0
      }
    }

    const missing: string[] = []
    if (val == null) missing.push("value")

    return {
      session_date: sessionDate,
      index_code: code,
      value: val,
      change: raw?.change != null ? Number(raw.change) : null,
      change_pct: raw?.perchange != null ? Number(raw.perchange) : null,
      reference: raw?.rIndex != null ? Number(raw.rIndex) : null,
      open,
      high: raw?.highIndex != null ? Number(raw.highIndex) : null,
      low: raw?.lowIndex != null ? Number(raw.lowIndex) : null,
      matched_volume: raw?.vol != null ? Number(raw.vol) : null,
      traded_value: raw?.value != null ? Number((Number(raw.value) / 1000).toFixed(2)) : null,
      previous_value_change_pct: null,
      advances,
      unchanged,
      declines,
      ceilings,
      floors,
      market_pe: null,
      foreign_buy_value: null,
      foreign_sell_value: null,
      foreign_net_value: null,
      quality_status: missing.length === 0 ? "healthy" : "degraded",
      missing_fields: missing,
      evidence_refs: [
        { field: "value", source_class: "canonical_market_feed", observed_at: asOfIso, unit: "points" },
      ],
      source_timestamp: asOfIso,
      as_of: asOfIso,
    }
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)

  const syncSecret = Deno.env.get("KFSP_SYNC_SECRET") || ""
  const authHeader = req.headers.get("authorization") || ""
  const customHeader = req.headers.get("x-sync-secret") || req.headers.get("x-kfsp-sync-secret") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : customHeader.trim()

  if (!syncSecret) return jsonResponse({ ok: false, error: "SYNC_SECRET_NOT_CONFIGURED" }, 503)
  if (!constantTimeEqual(syncSecret, token)) return jsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const supabaseKey = serviceRoleKey()
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, 500)

  const reqBody = await req.json().catch(() => ({})) as Record<string, unknown>
  const syncRunId = crypto.randomUUID()
  const asOfIso = new Date().toISOString()
  const sessionDate = deriveSessionDate(typeof reqBody.startedAt === "string" ? reqBody.startedAt : typeof reqBody.sessionDate === "string" ? reqBody.sessionDate : undefined)

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Create initial sync run
  const created = await supabase.from("market_insight_sync_runs").insert({
    id: syncRunId,
    session_date: sessionDate,
    trigger: typeof reqBody.trigger === "string" ? reqBody.trigger : "workflow",
    status: "running",
    contract_version: CONTRACT_VERSION,
  })
  if (created.error) return jsonResponse({ ok: false, error: "SYNC_RUN_CREATE_FAILED" }, 500)

  try {
    let auth = await getProviderToken(supabase)
    let currentHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.token}`,
      Origin: "https://kfsp.vn",
      Referer: "https://kfsp.vn/",
    }

    let pulse = await fetchJson(MARKET_PULSE_URL, { method: "GET", headers: currentHeaders })
    if (pulse.response.status === 401 || pulse.response.status === 403 || pulse.response.status === 423) {
      auth = await getProviderToken(supabase, true)
      currentHeaders = {
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
        Origin: "https://kfsp.vn",
        Referer: "https://kfsp.vn/",
      }
      pulse = await fetchJson(MARKET_PULSE_URL, { method: "GET", headers: currentHeaders })
    }

    const [cashFlows, topVolatility] = await Promise.all([
      fetchJson(CASH_FLOWS_URL, { method: "GET", headers: currentHeaders }).catch(() => ({ response: { ok: false } as Response, payload: null })),
      fetchJson(TOP_VOLATILITY_URL, { method: "GET", headers: currentHeaders }).catch(() => ({ response: { ok: false } as Response, payload: null })),
    ])

    const topTickers = Array.isArray(topVolatility.payload)
      ? (topVolatility.payload as unknown[]).map((t) => String(t || "").trim().toUpperCase()).filter((t) => /^[A-Z0-9]{2,12}$/.test(t))
      : []

    // Collect Socket.IO data (MA, Risk, Psychology, Sector pulse & breadth, getlive)
    const socketData = await collectSocketData(auth.token, topTickers)

    // Canonical indexes: validate strictly from body or fallback
    let canonicalIndexes = validateCanonicalIndexesInput(reqBody.canonicalIndexes, sessionDate, asOfIso)
    if (!canonicalIndexes) {
      canonicalIndexes = await fetchFallbackCanonicalIndexes(sessionDate, asOfIso)
    }

    if (!canonicalIndexes || canonicalIndexes.length !== 4 || canonicalIndexes.some((i) => i.value == null)) {
      throw new Error("VALIDATION_FAILED: canonicalIndexes missing or invalid for 4 required indexes")
    }

    const normalized = parseVerifiedMarketClosePayloads({
      sessionDate,
      asOfIso,
      pulseContentPayload: pulse.payload,
      pulseOk: pulse.response.ok,
      maBreadthPayload: socketData.maBreadth,
      maBreadthOk: Boolean(socketData.maBreadth),
      riskPayload: socketData.risk,
      riskOk: Boolean(socketData.risk),
      psychologyPayload: socketData.psychology,
      psychologyOk: Boolean(socketData.psychology),
      sectorPulsePayload: socketData.sectorPulse,
      sectorPulseOk: Boolean(socketData.sectorPulse),
      sectorBreadthPayload: socketData.sectorBreadth,
      sectorBreadthOk: Boolean(socketData.sectorBreadth),
      cashFlowsPayload: cashFlows.payload,
      cashFlowsOk: cashFlows.response.ok,
      topVolatilityTickers: topTickers,
      getLivePayload: socketData.getLive,
      getLiveOk: Boolean(socketData.getLive),
      canonicalIndexes,
    })

    const validation = validateMarketCloseSnapshot(normalized)
    if (!validation.valid) {
      throw new Error(`VALIDATION_FAILED: ${validation.errors.join("; ")}`)
    }

    if (normalized.quality_status === "failing") {
      throw new Error("VALIDATION_FAILED: Critical P0 coverage missing; quality_status is failing")
    }

    // Stage items
    const stagingBatch = normalized.staged_items.map((item) => ({
      run_id: syncRunId,
      category: item.category,
      staging_key: item.staging_key,
      normalized_payload: item.payload,
      observed_at: asOfIso,
    }))

    const CHUNK_SIZE = 50
    for (let index = 0; index < stagingBatch.length; index += CHUNK_SIZE) {
      const chunk = stagingBatch.slice(index, index + CHUNK_SIZE)
      const stageRes = await supabase.from("market_insight_snapshot_staging").insert(chunk)
      if (stageRes.error) {
        throw new Error(`STAGING_INSERT_FAILED: ${stageRes.error.message}`)
      }
    }

    // Persist pre-publish sync run metadata (coverage, staged counts, quality)
    await supabase.from("market_insight_sync_runs").update({
      source_observed_at: asOfIso,
      endpoint_coverage: normalized.endpoint_coverage,
      staged_counts: normalized.staged_counts,
      quality_status: normalized.quality_status,
    }).eq("id", syncRunId)

    // Atomic publish RPC
    const publishRes = await supabase.rpc("publish_market_insight_snapshot", {
      p_sync_run_id: syncRunId,
    })
    if (publishRes.error) {
      throw new Error(`PUBLISH_RPC_FAILED: ${publishRes.error.message}`)
    }

    return jsonResponse({
      ok: true,
      sync_run_id: syncRunId,
      session_date: sessionDate,
      published: publishRes.data,
      quality_status: normalized.quality_status,
      contract_version: CONTRACT_VERSION,
    })
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err)
    const sanitizedCode = rawMessage.startsWith("VALIDATION_FAILED")
      ? "VALIDATION_FAILED"
      : rawMessage.startsWith("STAGING_INSERT_FAILED")
        ? "STAGING_FAILED"
        : rawMessage.startsWith("PUBLISH_RPC_FAILED")
          ? "PUBLISH_FAILED"
          : "MARKET_INSIGHT_COLLECT_FAILED"

    await supabase.from("market_insight_sync_runs").update({
      status: "failed",
      sanitized_error_code: sanitizedCode,
      sanitized_error_message: rawMessage.slice(0, 500),
      completed_at: new Date().toISOString(),
    }).eq("id", syncRunId)

    return jsonResponse({
      ok: false,
      sync_run_id: syncRunId,
      error: sanitizedCode,
    }, 500)
  }
})
