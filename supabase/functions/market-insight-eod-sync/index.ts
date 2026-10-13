import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { io, type Socket } from "npm:socket.io-client@4.8.1"

import { getKfspProviderToken } from "../_shared/kfsp-provider-auth.ts"
import {
  parseVerifiedMarketClosePayloads,
  validateMarketCloseSnapshot,
  parseNumeric,
  normalizeSectorMaSlug,
  type NormalizedIndexRow,
} from "../_shared/market-close-normalizer.ts"
import {
  buildQeoExVnindexEstimate,
  type QeoCandidateRow,
  type QeoPreviousEstimate,
  type QeoRatingRun,
} from "../_shared/qeo-ex-vic-vhm-valuation.ts"

const PROVIDER_TIMEOUT_MS = 8_000
const SOCKET_TIMEOUT_MS = 10_000
const LOGIN_URL = Deno.env.get("KFSP_LOGIN_URL") || "https://api.kfsp.vn/api/login"
const MARKET_PULSE_URL = Deno.env.get("KFSP_MARKET_PULSE_URL") || "https://api.kfsp.vn/api/stocks/market_pulse/getContent?is_get_style=true&version=v3"
const CASH_FLOWS_URL = Deno.env.get("KFSP_CASH_FLOWS_URL") || "https://api2.kfsp.vn/api/stocks/dashboard/get-data-cash-flows"
const TOP_VOLATILITY_URL = Deno.env.get("KFSP_TOP_VOLATILITY_URL") || "https://api.kfsp.vn/api/stocks/dashboard/get-list-mack-market-volatility?type=volume_desc&board=1&limit=10"
const CONTRACT_VERSION = 2
const KFSP_AUTH_OPTIONS = { loginUrl: LOGIN_URL, timeoutMs: PROVIDER_TIMEOUT_MS, persistLogin: true } as const

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
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

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  const payload = await response.json().catch(() => null)
  return { response, payload }
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
  valuation: unknown
  sectorIbd: unknown
  sectorBreadth: unknown
  sectorRrg: unknown
  sectorMa: unknown
  indexLive: unknown
  getLive: unknown
}> {
  return new Promise((resolve) => {
    let resolved = false
    const results = {
      maBreadth: null as unknown,
      risk: null as unknown,
      psychology: null as unknown,
      valuation: null as unknown,
      sectorIbd: null as unknown,
      sectorBreadth: null as unknown,
      sectorRrg: null as unknown,
      sectorMa: null as unknown,
      indexLive: null as unknown,
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

    const needsLive = topTickers.length > 0
    const maybeResolve = () => {
      if (
        results.maBreadth &&
        results.risk &&
        results.psychology &&
        results.valuation &&
        results.sectorIbd &&
        results.sectorBreadth &&
        results.sectorRrg &&
        results.sectorMa &&
        results.indexLive &&
        (!needsLive || results.getLive)
      ) {
        cleanupAndResolve()
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
          maybeResolve()
        })

        socket?.emit("getdatariskindex", "VNINDEX", 200, (res: unknown) => {
          results.risk = res
          maybeResolve()
        })

        socket?.emit("getpsychologyindicator", "VNINDEX", 200, (res: unknown) => {
          results.psychology = res
          maybeResolve()
        })

        socket?.emit("getvaluationindex", "VNINDEX", 200, (res: unknown) => {
          results.valuation = res
          maybeResolve()
        })

        socket?.emit("getdataibdnganh", (res: unknown) => {
          results.sectorIbd = res
          maybeResolve()
          const sectorNames = (res as any)?.ten_nganh
          if (Array.isArray(sectorNames) && sectorNames.length > 0) {
            socket?.emit("getincreasesdecreasesnganh", sectorNames, (bRes: unknown) => {
              results.sectorBreadth = bRes
              maybeResolve()
            })
            socket?.emit("getdatarrgnganh", sectorNames, "VNINDEX", 9, (rrgRes: unknown) => {
              results.sectorRrg = rrgRes
              maybeResolve()
            })
            socket?.emit("getdatama", sectorNames.map((name: unknown) => normalizeSectorMaSlug(String(name || ""))), (maRes: unknown) => {
              results.sectorMa = maRes
              maybeResolve()
            })
          }
        })

        socket?.emit("getliveindex", ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"], (res: unknown) => {
          results.indexLive = res
          maybeResolve()
        })

        if (topTickers.length > 0) {
          socket?.emit("getlive", topTickers, (res: unknown) => {
            results.getLive = res
            maybeResolve()
          })
        }
      })

      socket.on("connect_error", cleanupAndResolve)
    } catch {
      cleanupAndResolve()
    }
  })
}

function normalizeProviderIndexes(input: unknown, sessionDate: string, asOfIso: string): NormalizedIndexRow[] | null {
  const source = asObject(input)
  if (!source || !Array.isArray(source.stockcode)) return null
  const providerCodes = ["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX"] as const
  const canonicalCodes = ["VNINDEX", "VN30", "HNX", "UPCOM"] as const
  const rows: NormalizedIndexRow[] = []

  for (let canonicalIndex = 0; canonicalIndex < providerCodes.length; canonicalIndex += 1) {
    const req = providerCodes[canonicalIndex]
    const position = source.stockcode.findIndex((value) => String(value || "").toUpperCase() === req)
    if (position < 0) return null
    const at = (key: string) => Array.isArray(source[key]) ? source[key][position] : null
    const val = parseNumeric(at("lastprice"))
    if (val == null || val <= 0) return null
    const change = parseNumeric(at("change"))

    rows.push({
      session_date: sessionDate,
      index_code: canonicalCodes[canonicalIndex],
      value: val,
      change,
      change_pct: parseNumeric(at("perchange")),
      reference: change == null ? null : Number((val - change).toFixed(4)),
      open: null,
      high: null,
      low: null,
      matched_volume: parseNumeric(at("totalvol")),
      traded_value: parseNumeric(at("totalvalue")),
      previous_value_change_pct: null,
      advances: Math.max(0, Math.round(parseNumeric(at("advances")) ?? 0)),
      unchanged: Math.max(0, Math.round(parseNumeric(at("nochange")) ?? 0)),
      declines: Math.max(0, Math.round(parseNumeric(at("declines")) ?? 0)),
      ceilings: 0,
      floors: 0,
      market_pe: null,
      foreign_buy_value: null,
      foreign_sell_value: null,
      foreign_net_value: null,
      quality_status: "healthy",
      missing_fields: [],
      evidence_refs: [{ field: "value", source_class: "market_indexes", observed_at: asOfIso, unit: "points" }],
      source_timestamp: asOfIso,
      as_of: asOfIso,
    })
  }

  return rows
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function loadQeoRatingSource(supabase: SupabaseClient, sessionDate: string, requestedRunId: string | null) {
  if (!requestedRunId || !isUuid(requestedRunId)) return { ratingRun: null, candidates: [] as QeoCandidateRow[] }

  const runResult = await supabase
    .from("kfsp_rating_sync_runs")
    .select("id,as_of_date,status,provider_row_count,contract_version,completed_at")
    .eq("id", requestedRunId)
    .maybeSingle()
  if (runResult.error) throw new Error("QEO_RATING_RUN_READ_FAILED")
  const row = runResult.data
  if (!row) return { ratingRun: null, candidates: [] as QeoCandidateRow[] }

  const ratingRun: QeoRatingRun = {
    id: String(row.id),
    asOfDate: String(row.as_of_date || ""),
    status: String(row.status || ""),
    providerRowCount: Number(row.provider_row_count),
    contractVersion: Number(row.contract_version),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  }

  const countResult = await supabase
    .from("kfsp_universe_candidate_snapshots")
    .select("ticker", { count: "exact", head: true })
    .eq("as_of_date", sessionDate)
    .eq("sync_run_id", requestedRunId)
  if (countResult.error) throw new Error("QEO_CANDIDATE_COUNT_READ_FAILED")

  const actualCount = countResult.count || 0
  if (actualCount > 10_000) throw new Error("QEO_CANDIDATE_COUNT_UNBOUNDED")
  const candidates: QeoCandidateRow[] = []
  const pageSize = 500
  for (let offset = 0; offset < actualCount; offset += pageSize) {
    const page = await supabase
      .from("kfsp_universe_candidate_snapshots")
      .select("as_of_date,ticker,exchange,market_cap_billion,price,price_change_pct,pe_ttm,pb_ttm,sync_run_id,fetched_at")
      .eq("as_of_date", sessionDate)
      .eq("sync_run_id", requestedRunId)
      .order("ticker", { ascending: true })
      .range(offset, Math.min(offset + pageSize - 1, actualCount - 1))
    if (page.error) throw new Error("QEO_CANDIDATE_PAGE_READ_FAILED")
    const pageRows = page.data || []
    candidates.push(...pageRows.map((candidate) => ({
      asOfDate: String(candidate.as_of_date || ""),
      ticker: String(candidate.ticker || ""),
      exchange: candidate.exchange == null ? null : String(candidate.exchange),
      marketCapBillion: parseNumeric(candidate.market_cap_billion),
      price: parseNumeric(candidate.price),
      priceChangePct: parseNumeric(candidate.price_change_pct),
      pe: parseNumeric(candidate.pe_ttm),
      pb: parseNumeric(candidate.pb_ttm),
      syncRunId: String(candidate.sync_run_id || ""),
      fetchedAt: String(candidate.fetched_at || ""),
    })))
    if (pageRows.length === 0) break
  }

  return { ratingRun, candidates }
}

function qeoPreviousEstimate(value: Record<string, unknown> | null): QeoPreviousEstimate | null {
  if (!value) return null
  return {
    sessionDate: String(value.session_date || ""),
    status: value.status === "available" ? "available" : "unavailable",
    estimatedVnindexValue: parseNumeric(value.estimated_vnindex_value),
    baseSessionDate: value.base_session_date == null ? null : String(value.base_session_date),
    baseVnindexValue: parseNumeric(value.base_vnindex_value),
    sourceHoseCount: Number(value.source_hose_count || 0),
  }
}

function safePositiveNumber(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null
}

function safePriceChange(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > -100 ? value : null
}

async function publishQeoEstimate(input: {
  supabase: SupabaseClient
  sessionDate: string
  asOfIso: string
  sourceMarketSyncRunId: string
  ratingSyncRunId: string | null
  providerIndexes: NormalizedIndexRow[]
}): Promise<{ status: string; reason: string | null }> {
  const { supabase, sessionDate, asOfIso, sourceMarketSyncRunId, ratingSyncRunId, providerIndexes } = input
  let estimate: ReturnType<typeof buildQeoExVnindexEstimate> | null = null

  try {
    const [{ ratingRun, candidates }, currentIndexResult, previousMarketResult, previousEstimateResult] = await Promise.all([
      loadQeoRatingSource(supabase, sessionDate, ratingSyncRunId),
      supabase.from("market_insight_indexes").select("value").eq("session_date", sessionDate).eq("index_code", "VNINDEX").maybeSingle(),
      supabase.from("market_insight_daily").select("session_date").lt("session_date", sessionDate).order("session_date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("market_insight_qeo_ex_vnindex_daily").select("session_date,status,estimated_vnindex_value,base_session_date,base_vnindex_value,source_hose_count").lt("session_date", sessionDate).order("session_date", { ascending: false }).limit(1).maybeSingle(),
    ])
    if (currentIndexResult.error || previousMarketResult.error || previousEstimateResult.error) {
      throw new Error("QEO_PREVIOUS_OR_PUBLISHED_VALUE_READ_FAILED")
    }

    const breadthRow = providerIndexes.find((row) => row.index_code === "VNINDEX")
    const observedBreadth = breadthRow ? breadthRow.advances + breadthRow.unchanged + breadthRow.declines : 0
    const providerBreadthCount = Number.isFinite(observedBreadth) && observedBreadth > 0 ? observedBreadth : null
    estimate = buildQeoExVnindexEstimate({
      sessionDate,
      ratingRun,
      candidates,
      vnindexValue: parseNumeric(currentIndexResult.data?.value),
      providerBreadthCount,
      previousMarketSessionDate: previousMarketResult.data?.session_date ? String(previousMarketResult.data.session_date) : null,
      previousEstimate: qeoPreviousEstimate(previousEstimateResult.data as Record<string, unknown> | null),
      asOf: asOfIso,
      sourceMarketSyncRunId,
    })

    const hoseCandidates = candidates
      .filter((candidate) => candidate.exchange?.trim().toUpperCase() === "HOSE")
      .slice()
      .sort((left, right) => left.ticker.localeCompare(right.ticker))
    estimate.sourceHoseHash = await sha256Hex(hoseCandidates.map((candidate) => ({
      asOfDate: candidate.asOfDate,
      ticker: candidate.ticker.trim().toUpperCase(),
      exchange: candidate.exchange?.trim().toUpperCase() || null,
      marketCapBillion: candidate.marketCapBillion,
      price: candidate.price,
      priceChangePct: candidate.priceChangePct,
      pe: candidate.pe,
      pb: candidate.pb,
      syncRunId: candidate.syncRunId,
      fetchedAt: candidate.fetchedAt,
    })))
    estimate.retainedMemberHash = await sha256Hex(estimate.members.filter((member) => member.includedInEstimate).map((member) => member.ticker))
  } catch {
    const unavailable = buildQeoExVnindexEstimate({
      sessionDate,
      ratingRun: null,
      candidates: [],
      vnindexValue: null,
      providerBreadthCount: null,
      previousMarketSessionDate: null,
      previousEstimate: null,
      asOf: asOfIso,
      sourceMarketSyncRunId,
    })
    unavailable.unavailableReason = "OPTIONAL_DERIVATION_FAILED"
    unavailable.sourceRatingSyncRunId = ratingSyncRunId
    estimate = unavailable
  }

  estimate.sourceHoseHash ||= await sha256Hex([])
  estimate.retainedMemberHash ||= await sha256Hex(estimate.members.filter((member) => member.includedInEstimate).map((member) => member.ticker))
  estimate.calculationInputHash = await sha256Hex({
    sessionDate: estimate.sessionDate,
    calculationVersion: estimate.calculationVersion,
    sourceMarketSyncRunId: estimate.sourceMarketSyncRunId,
    sourceRatingSyncRunId: estimate.sourceRatingSyncRunId,
    sourceContractVersion: estimate.sourceContractVersion,
    sourceCandidateCount: estimate.sourceCandidateCount,
    sourceHoseCount: estimate.sourceHoseCount,
    retainedMemberCount: estimate.retainedMemberCount,
    sourceHoseHash: estimate.sourceHoseHash,
    retainedMemberHash: estimate.retainedMemberHash,
    sourceObservedFrom: estimate.sourceObservedFrom,
    sourceObservedTo: estimate.sourceObservedTo,
    providerBreadthCount: estimate.providerBreadthCount,
    providerBreadthDifference: estimate.providerBreadthDifference,
    baseSessionDate: estimate.baseSessionDate,
    baseVnindexValue: estimate.baseVnindexValue,
    previousMarketSessionDate: estimate.previousMarketSessionDate,
    previousEstimateSessionDate: estimate.previousEstimateSessionDate,
    previousEstimatedVnindexValue: estimate.previousEstimatedVnindexValue,
    estimatedVnindexValue: estimate.estimatedVnindexValue,
    marketCapBillion: estimate.marketCapBillion,
    referenceMarketCapBillion: estimate.referenceMarketCapBillion,
    pe: estimate.pe,
    pb: estimate.pb,
  })

  const memberPayload = estimate.members.map((member) => ({
    ...member,
    exchange: "HOSE",
    marketCapBillion: safePositiveNumber(member.marketCapBillion),
    price: safePositiveNumber(member.price),
    priceChangePct: safePriceChange(member.priceChangePct),
    referenceMarketCapBillion: safePositiveNumber(member.referenceMarketCapBillion),
  }))
  const published = await supabase.rpc("publish_market_insight_qeo_ex_vnindex_estimate", {
    p_payload: { estimate, members: memberPayload },
  })
  if (published.error) {
    console.error("Qeo ex VIC/VHM estimate persistence failed", "QEO_ESTIMATE_PERSIST_FAILED")
    return { status: "unavailable", reason: "QEO_ESTIMATE_PERSIST_FAILED" }
  }
  return {
    status: typeof published.data?.status === "string" ? published.data.status : estimate.status,
    reason: typeof published.data?.unavailable_reason === "string" ? published.data.unavailable_reason : estimate.unavailableReason,
  }
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
  const ratingSyncRunId = typeof reqBody.ratingSyncRunId === "string" ? reqBody.ratingSyncRunId : null
  const sessionDate = deriveSessionDate(typeof reqBody.startedAt === "string" ? reqBody.startedAt : typeof reqBody.sessionDate === "string" ? reqBody.sessionDate : undefined)

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const created = await supabase.from("market_insight_sync_runs").insert({
    id: syncRunId,
    session_date: sessionDate,
    trigger: typeof reqBody.trigger === "string" ? reqBody.trigger : "workflow",
    status: "running",
    contract_version: CONTRACT_VERSION,
  })
  if (created.error) return jsonResponse({ ok: false, error: "SYNC_RUN_CREATE_FAILED" }, 500)

  try {
    let auth = await getKfspProviderToken(supabase, KFSP_AUTH_OPTIONS)
    let currentHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${auth.token}`,
      Origin: "https://kfsp.vn",
      Referer: "https://kfsp.vn/",
    }

    let pulseUrl = `${MARKET_PULSE_URL}&token=${encodeURIComponent(auth.token)}`
    let pulse = await fetchJson(pulseUrl, { method: "GET", headers: currentHeaders })
    if (pulse.response.status === 401 || pulse.response.status === 403 || pulse.response.status === 423) {
      auth = await getKfspProviderToken(supabase, KFSP_AUTH_OPTIONS, true)
      currentHeaders = {
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`,
        Origin: "https://kfsp.vn",
        Referer: "https://kfsp.vn/",
      }
      pulseUrl = `${MARKET_PULSE_URL}&token=${encodeURIComponent(auth.token)}`
      pulse = await fetchJson(pulseUrl, { method: "GET", headers: currentHeaders })
    }

    const volatilityUrl = `${TOP_VOLATILITY_URL}&token=${encodeURIComponent(auth.token)}`
    const [cashFlows, topVolatility] = await Promise.all([
      fetchJson(CASH_FLOWS_URL, { method: "GET", headers: currentHeaders }).catch(() => ({ response: { ok: false } as Response, payload: null })),
      fetchJson(volatilityUrl, { method: "GET", headers: currentHeaders }).catch(() => ({ response: { ok: false } as Response, payload: null })),
    ])

    const topTickers = Array.isArray(topVolatility.payload)
      ? (topVolatility.payload as unknown[]).map((t) => String(t || "").trim().toUpperCase()).filter((t) => /^[A-Z0-9]{2,12}$/.test(t))
      : []

    const socketData = await collectSocketData(auth.token, topTickers)

    const providerIndexes = normalizeProviderIndexes(socketData.indexLive, sessionDate, asOfIso)
    if (!providerIndexes || providerIndexes.length !== 4 || providerIndexes.some((i) => i.value == null)) {
      throw new Error("VALIDATION_FAILED: KFSP getliveindex missing or invalid for 4 required indexes")
    }

    const contributorCandidateRes = await supabase
      .from("kfsp_universe_candidate_snapshots")
      .select("ticker,exchange,market_cap_billion,price_change_pct,price")
      .eq("as_of_date", sessionDate)
      .eq("exchange", "HOSE")
    if (contributorCandidateRes.error) {
      throw new Error(`CONTRIBUTOR_CANDIDATE_READ_FAILED: ${contributorCandidateRes.error.message}`)
    }
    const contributorCandidates = (contributorCandidateRes.data || []).map((row) => ({
      ticker: String(row.ticker || "").trim().toUpperCase(),
      exchange: row.exchange != null ? String(row.exchange) : null,
      marketCapBillion: parseNumeric(row.market_cap_billion),
      changePct: parseNumeric(row.price_change_pct),
      price: parseNumeric(row.price),
    }))

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
      valuationPayload: socketData.valuation,
      valuationOk: Boolean(socketData.valuation),
      sectorIbdPayload: socketData.sectorIbd,
      sectorIbdOk: Boolean(socketData.sectorIbd),
      sectorRrgPayload: socketData.sectorRrg,
      sectorRrgOk: Boolean(socketData.sectorRrg),
      sectorMaPayload: socketData.sectorMa,
      sectorMaOk: Boolean(socketData.sectorMa),
      sectorBreadthPayload: socketData.sectorBreadth,
      sectorBreadthOk: Boolean(socketData.sectorBreadth),
      cashFlowsPayload: cashFlows.payload,
      cashFlowsOk: cashFlows.response.ok,
      topVolatilityTickers: topTickers,
      getLivePayload: socketData.getLive,
      getLiveOk: Boolean(socketData.getLive),
      contributorCandidates,
      providerIndexes,
    })

    const payloadChecksum = await sha256Hex({
      contractVersion: normalized.contract_version,
      sessionDate,
      asOf: asOfIso,
      daily: normalized.daily,
      indexes: normalized.indexes,
      sectors: normalized.sectors,
      leaders: normalized.leaders,
    })
    await supabase.from("market_insight_sync_runs").update({
      source_observed_at: asOfIso,
      endpoint_coverage: normalized.endpoint_coverage,
      staged_counts: normalized.staged_counts,
      quality_status: normalized.quality_status,
      payload_checksum: payloadChecksum,
    }).eq("id", syncRunId)

    const validation = validateMarketCloseSnapshot(normalized)
    if (!validation.valid) {
      throw new Error(`VALIDATION_FAILED: ${validation.errors.join("; ")}`)
    }

    if (normalized.quality_status === "failing") {
      const missingKeys = Object.entries(normalized.endpoint_coverage)
        .filter(([, v]) => !v)
        .map(([k]) => k)
      throw new Error(`VALIDATION_FAILED: Critical P0 coverage missing: [${missingKeys.join(", ")}]; quality_status is failing`)
    }

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

    const publishRes = await supabase.rpc("publish_market_insight_snapshot_v2", {
      p_sync_run_id: syncRunId,
    })
    if (publishRes.error) {
      throw new Error(`PUBLISH_RPC_FAILED: ${publishRes.error.message}`)
    }

    const publishedCounts = { daily: normalized.staged_counts.daily, index: normalized.staged_counts.index, sector: normalized.staged_counts.sector, leader: normalized.staged_counts.leader, total: normalized.staged_counts.total }
    const publishedUpdate = await supabase.from("market_insight_sync_runs").update({ published_counts: publishedCounts, payload_checksum: payloadChecksum }).eq("id", syncRunId)
    if (publishedUpdate.error) throw new Error(`PUBLISH_METADATA_FAILED: ${publishedUpdate.error.message}`)

    let qeoEstimate = { status: "unavailable", reason: "QEO_OPTIONAL_STEP_NOT_RUN" as string | null }
    try {
      qeoEstimate = await publishQeoEstimate({
        supabase,
        sessionDate,
        asOfIso,
        sourceMarketSyncRunId: syncRunId,
        ratingSyncRunId,
        providerIndexes,
      })
    } catch {
      // The Qeo estimate is optional and must never invalidate the published
      // market snapshot. The EOD phase summary records this status for review.
      console.error("Qeo ex VIC/VHM estimate step failed", "QEO_OPTIONAL_STEP_FAILED")
    }

    return jsonResponse({
      ok: true,
      sync_run_id: syncRunId,
      session_date: sessionDate,
      published: publishRes.data,
      quality_status: normalized.quality_status,
      contract_version: CONTRACT_VERSION,
      qeo_ex_vnindex_status: qeoEstimate.status,
      qeo_ex_vnindex_reason: qeoEstimate.reason,
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
