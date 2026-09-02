import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

import {
  KFSP_CONTRACT_VERSION,
  KFSP_FIELD_BY_PROVIDER_KEY,
  KFSP_GROUPS,
  type KfspGroupKey,
} from "../_shared/kfsp-catalog.ts"
import { getKfspProviderToken } from "../_shared/kfsp-provider-auth.ts"
import {
  beginManualKfspLifecycle,
  finalizeManualKfspLifecycle,
  manualKfspRequestId,
  type ManualKfspContext,
} from "../_shared/kfsp-manual-lifecycle.ts"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }
type MetricGroups = Record<KfspGroupKey, Record<string, JsonValue>> & {
  unmapped: Record<string, JsonValue>
  metadata: Record<string, JsonValue>
}

const PROVIDER_TIMEOUT_MS = 8_000
const FILTER_URL = Deno.env.get("KFSP_FILTER_URL") || "https://api2.kfsp.vn/api/filter"
const SUPPLEMENTAL_URL = Deno.env.get("KFSP_SUPPLEMENTAL_URL") || "https://api2.kfsp.vn/api/watchlist/canslim-fourm/by-mack"
const LOGIN_URL = Deno.env.get("KFSP_LOGIN_URL") || "https://api.kfsp.vn/api/login"
const CANDIDATE_RETENTION_DAYS = 14
const KFSP_AUTH_OPTIONS = { loginUrl: LOGIN_URL, timeoutMs: PROVIDER_TIMEOUT_MS, persistLogin: false } as const

function jsonResponse(body: JsonObject, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function serviceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (legacy) return legacy
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS")
  if (!encoded) return ""
  try { return String(JSON.parse(encoded)?.default || "") } catch { return "" }
}

function constantTimeEqual(left: string, right: string) {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let mismatch = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return mismatch === 0
}

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  const payload = await response.json().catch(() => null)
  return { response, payload }
}

async function fetchFilterPayload(token: string) {
  return fetchJson(FILTER_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", Origin: "https://kfsp.vn", Referer: "https://kfsp.vn/" },
    body: JSON.stringify({ content: [], mack: "", watchlistId: "all", token }),
  })
}

async function fetchSupplementalRecords(token: string, tickers: string[]) {
  const batches: string[][] = []
  for (let index = 0; index < tickers.length; index += 150) batches.push(tickers.slice(index, index + 150))
  const results = await Promise.allSettled(batches.map(async (batch) => {
    const url = new URL(SUPPLEMENTAL_URL)
    for (const ticker of batch) url.searchParams.append("mack[]", ticker)
    url.searchParams.set("token", token)
    const { response, payload } = await fetchJson(url.toString(), { method: "GET", headers: { Accept: "application/json", Origin: "https://kfsp.vn", Referer: "https://kfsp.vn/" } })
    if (!response.ok) throw new Error(`KFSP_SUPPLEMENTAL_HTTP_${response.status}`)
    const root = asObject(payload)
    const records = Array.isArray(payload) ? payload : Array.isArray(root?.data) ? root.data : []
    return records.flatMap((record) => {
      const object = asObject(record)
      const ticker = String(object?.mack || object?.ticker || "").trim().toUpperCase()
      return object && ticker ? [[ticker, object] as const] : []
    })
  }))
  return new Map(results.flatMap((result) => result.status === "fulfilled" ? result.value : []))
}

function normalizeTickers(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;,\s]+/) : []
  return values.flatMap((value) => {
    const ticker = String(value || "").trim().toUpperCase()
    return /^[A-Z0-9]{2,12}$/.test(ticker) ? [ticker] : []
  })
}

async function loadCanonicalTickers(supabase: SupabaseClient) {
  const current = await supabase.rpc("qeo_current_market_universe", { p_universe_key: "vn_top_stocks" })
  if (current.error) throw new Error("KFSP_UNIVERSE_READ_FAILED")
  const payload = asObject(Array.isArray(current.data) ? current.data[0] : current.data)
  const stocks = Array.isArray(payload?.stocks) ? payload.stocks : []
  const tickers = stocks
    .map((item) => String(asObject(item)?.ticker || "").trim().toUpperCase())
    .filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker))
  if (!tickers.length || tickers.length > 200 || new Set(tickers).size !== tickers.length) throw new Error(`KFSP_UNIVERSE_INVALID:${tickers.length}`)
  const selectedCount = Number(payload?.selectedCount)
  if (Number.isFinite(selectedCount) && selectedCount !== tickers.length) throw new Error(`KFSP_UNIVERSE_COUNT_MISMATCH:${selectedCount}:${tickers.length}`)
  return tickers
}

function unknownKey(providerKey: string) {
  let hash = 2166136261
  for (let index = 0; index < providerKey.length; index += 1) { hash ^= providerKey.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return `unmapped_field_${(hash >>> 0).toString(16).padStart(8, "0")}`
}

function jsonValue(value: unknown): JsonValue {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as JsonValue
  if (Array.isArray(value)) return value.map(jsonValue)
  const object = asObject(value)
  if (!object) return String(value)
  return Object.fromEntries(Object.entries(object).map(([key, nested]) => [key, jsonValue(nested)]))
}

function emptyMetricGroups(): MetricGroups {
  const groups = Object.fromEntries(KFSP_GROUPS.map((group) => [group.key, {}])) as Record<KfspGroupKey, Record<string, JsonValue>>
  return { ...groups, unmapped: {}, metadata: {} }
}

function normalizeProviderRecord(record: Record<string, unknown>) {
  const metrics = emptyMetricGroups()
  const englishRecord: Record<string, JsonValue> = {}
  const providerKeyMap: Record<string, JsonValue> = {}
  for (const [providerKey, rawValue] of Object.entries(record)) {
    const definition = KFSP_FIELD_BY_PROVIDER_KEY.get(providerKey)
    const key = definition?.key || unknownKey(providerKey)
    const value = jsonValue(rawValue)
    englishRecord[key] = value
    providerKeyMap[key] = providerKey
    if (definition) metrics[definition.group][key] = value
    else metrics.unmapped[key] = value
  }
  const overviewKeys = ["ticker", "sector", "exchange", "price", "price_change_pct", "kfsp_canslim_score", "kfsp_score_4m", "kfsp_price_potential", "kfsp_fair_value", "average_volume_50_sessions", "average_volume_50d", "market_cap_billion", "rs_short", "rs_medium", "rs_long", "rsi_14", "weekly_change_pct", "monthly_change_pct", "beta", "pe_ttm", "pb_ttm"]
  for (const key of overviewKeys) for (const group of KFSP_GROUPS) if (key in metrics[group.key]) metrics.overview[key] = metrics[group.key][key]
  if ("kfsp_stock_rs_score" in metrics.kfsp) metrics.overview.rs_short = metrics.kfsp.kfsp_stock_rs_score
  metrics.metadata.provider_key_map = providerKeyMap
  metrics.metadata.contract_version = KFSP_CONTRACT_VERSION
  return { metrics, englishRecord }
}

function findMetric(metrics: MetricGroups, key: string): JsonValue | undefined {
  for (const group of KFSP_GROUPS) if (key in metrics[group.key]) return metrics[group.key][key]
  return undefined
}
function numeric(value: JsonValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "--" || trimmed === "-") return null
  const parsed = Number(trimmed.replace(/,/g, "").replace(/%/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}
function textValue(value: JsonValue | undefined): string | null { if (value == null) return null; const text = String(value).trim(); return text && text !== "--" ? text : null }
function score(value: JsonValue | undefined) { const parsed = numeric(value); return parsed != null && parsed >= 0 && parsed <= 100 ? parsed : null }
function compositeScore(values: Array<number | null>) { const valid = values.filter((value): value is number => value != null); return valid.length ? Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length * 100) / 100 : null }
function pricePotentialLabel(value: JsonValue | undefined) { return typeof value === "string" && value.trim() ? value.trim() : null }

function buildProviderRows(payload: unknown, supplemental: Map<string, Record<string, unknown>>, asOfDate: string, syncRunId: string, fetchedAt: string) {
  const root = asObject(payload)
  const source = asObject(root?.data) || root
  if (!source) throw new Error("KFSP_FILTER_RESPONSE_INVALID")
  const tickers = normalizeTickers(source.mack)
  if (!tickers.length) throw new Error("KFSP_FILTER_TICKERS_MISSING")
  if (new Set(tickers).size !== tickers.length) throw new Error("KFSP_FILTER_DUPLICATE_TICKERS")
  const fields = Object.entries(source).filter(([, value]) => Array.isArray(value))

  return tickers.map((ticker, index) => {
    const providerRecord: Record<string, unknown> = { mack: ticker }
    for (const [key, values] of fields) providerRecord[key] = (values as unknown[])[index] ?? null
    Object.assign(providerRecord, supplemental.get(ticker) || {})
    const { metrics, englishRecord } = normalizeProviderRecord(providerRecord)
    const score4m = score(findMetric(metrics, "kfsp_score_4m"))
    const canslim = score(findMetric(metrics, "kfsp_canslim_score"))
    const stockRs = score(findMetric(metrics, "kfsp_stock_rs_score"))
    const sectorRs = score(findMetric(metrics, "kfsp_sector_rs_score"))
    const providerPrice = numeric(findMetric(metrics, "price"))
    const price = providerPrice == null ? null : providerPrice / 1_000
    if (price != null) metrics.overview.price = price

    return {
      sync_run_id: syncRunId,
      as_of_date: asOfDate,
      ticker,
      company_name: textValue(findMetric(metrics, "company_name")),
      sector: textValue(findMetric(metrics, "sector")),
      industry_group: textValue(findMetric(metrics, "sector")),
      exchange: textValue(findMetric(metrics, "exchange")),
      price,
      price_change_pct: numeric(findMetric(metrics, "price_change_pct")) ?? numeric(findMetric(metrics, "price_change_1d_pct")),
      average_volume_50_sessions: Math.max(0, Math.round(numeric(findMetric(metrics, "average_volume_50_sessions")) ?? numeric(findMetric(metrics, "average_volume_50d")) ?? 0)) || null,
      market_cap_billion: numeric(findMetric(metrics, "market_cap_billion")),
      kfsp_composite_score: compositeScore([score4m, canslim, stockRs, sectorRs]),
      kfsp_score_4m: score4m,
      kfsp_canslim_score: canslim,
      kfsp_price_potential: pricePotentialLabel(findMetric(metrics, "kfsp_price_potential")),
      kfsp_stock_rs_score: stockRs,
      kfsp_sector_rs_score: sectorRs,
      kfsp_stock_rrg_state: textValue(findMetric(metrics, "kfsp_stock_rrg_state")),
      kfsp_sector_rrg_state: textValue(findMetric(metrics, "kfsp_sector_rrg_state")),
      rs_short: numeric(findMetric(metrics, "rs_short")),
      rs_medium: numeric(findMetric(metrics, "rs_medium")),
      rsi_14: numeric(findMetric(metrics, "rsi_14")),
      weekly_change_pct: numeric(findMetric(metrics, "weekly_change_pct")) ?? numeric(findMetric(metrics, "price_change_1w_pct")),
      monthly_change_pct: numeric(findMetric(metrics, "monthly_change_pct")) ?? numeric(findMetric(metrics, "price_change_1m_pct")),
      beta: numeric(findMetric(metrics, "beta")),
      pe_ttm: numeric(findMetric(metrics, "pe_ttm")),
      pb_ttm: numeric(findMetric(metrics, "pb_ttm")),
      kfsp_metrics: metrics,
      raw_payload: { provider_record: englishRecord },
      fetched_at: fetchedAt,
    }
  })
}

function calendarDaysBefore(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function vietnamDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
  const expectedSecret = Deno.env.get("KFSP_SYNC_SECRET") || ""
  const providedSecret = req.headers.get("x-kfsp-sync-secret") || ""
  if (!expectedSecret) return jsonResponse({ ok: false, error: "SYNC_SECRET_NOT_CONFIGURED" }, 503)
  if (!constantTimeEqual(expectedSecret, providedSecret)) return jsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401)

  const requestBody = asObject(await req.json().catch(() => null))
  let manualRequestId: string | null = null
  try {
    manualRequestId = manualKfspRequestId(requestBody)
  } catch {
    return jsonResponse({ ok: false, error: "KFSP_MANUAL_REQUEST_ID_INVALID" }, 400)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const supabaseKey = serviceRoleKey()
  if (!supabaseUrl || !supabaseKey) return jsonResponse({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, 500)
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const syncRunId = manualRequestId ?? crypto.randomUUID()
  const asOfDate = vietnamDate()
  const fetchedAt = new Date().toISOString()
  let tokenRefreshed = false
  let manualContext: ManualKfspContext | null = null

  const created = await supabase.from("kfsp_rating_sync_runs").insert({ id: syncRunId, as_of_date: asOfDate, status: "running", contract_version: KFSP_CONTRACT_VERSION })
  if (created.error) {
    if (manualRequestId && String(created.error.code || "") === "23505") {
      const existing = await supabase.from("kfsp_rating_sync_runs").select("status,error_code").eq("id", syncRunId).maybeSingle()
      const status = String(existing.data?.status || "running")
      return jsonResponse({ ok: status === "completed", duplicate: true, sync_run_id: syncRunId, status, error: existing.data?.error_code || null }, status === "running" ? 202 : 200)
    }
    return jsonResponse({ ok: false, error: "SYNC_RUN_CREATE_FAILED" }, 500)
  }

  try {
    const lifecycle = await beginManualKfspLifecycle(supabase, {
      requestBody,
      jobKey: "kfsp.rating_daily",
      syncRunId,
    })
    manualContext = lifecycle.context
    if (lifecycle.duplicate) {
      return jsonResponse({ ok: lifecycle.status === "succeeded", duplicate: true, sync_run_id: syncRunId, status: lifecycle.status || "running" }, lifecycle.status === "running" ? 202 : 200)
    }

    const canonicalTickers = await loadCanonicalTickers(supabase)
    let auth = await getKfspProviderToken(supabase, KFSP_AUTH_OPTIONS)
    tokenRefreshed = auth.refreshed
    let filter = await fetchFilterPayload(auth.token)
    if (filter.response.status === 401 || filter.response.status === 403) {
      auth = await getKfspProviderToken(supabase, KFSP_AUTH_OPTIONS, true)
      tokenRefreshed = true
      filter = await fetchFilterPayload(auth.token)
    }
    if (!filter.response.ok) throw new Error(`KFSP_FILTER_HTTP_${filter.response.status}`)

    const supplemental = await fetchSupplementalRecords(auth.token, canonicalTickers)
    const providerRows = buildProviderRows(filter.payload, supplemental, asOfDate, syncRunId, fetchedAt)
    const byTicker = new Map(providerRows.map((row) => [row.ticker, row]))
    const missingCanonical = canonicalTickers.filter((ticker) => !byTicker.has(ticker))
    if (missingCanonical.length) throw new Error(`KFSP_CANONICAL_COVERAGE_INCOMPLETE:${missingCanonical.length}`)
    const rows = canonicalTickers.map((ticker) => byTicker.get(ticker)!)
    if (rows.some((row) => row.kfsp_composite_score == null && row.kfsp_score_4m == null && row.kfsp_canslim_score == null && row.kfsp_stock_rs_score == null)) throw new Error("KFSP_FILTER_SCORE_MISSING")

    const candidateRows = providerRows.map((row) => ({
      as_of_date: row.as_of_date,
      ticker: row.ticker,
      company_name: row.company_name,
      exchange: row.exchange,
      sector: row.sector,
      market_cap_billion: row.market_cap_billion,
      average_volume_50_sessions: row.average_volume_50_sessions,
      volume_1d: numeric(row.kfsp_metrics.liquidity.volume_1d),
      sync_run_id: syncRunId,
      fetched_at: fetchedAt,
    }))
    for (let index = 0; index < candidateRows.length; index += 250) {
      const candidateWrite = await supabase.from("kfsp_universe_candidate_snapshots").upsert(candidateRows.slice(index, index + 250), { onConflict: "as_of_date,ticker" })
      if (candidateWrite.error) throw new Error(`KFSP_CANDIDATE_WRITE_FAILED:${candidateWrite.error.code || "unknown"}`)
    }
    const candidatePrune = await supabase.from("kfsp_universe_candidate_snapshots").delete().lt("as_of_date", calendarDaysBefore(asOfDate, CANDIDATE_RETENTION_DAYS))
    if (candidatePrune.error) throw new Error(`KFSP_CANDIDATE_PRUNE_FAILED:${candidatePrune.error.code || "unknown"}`)

    await supabase.from("kfsp_rating_sync_runs").update({ provider_row_count: providerRows.length, token_refreshed: tokenRefreshed }).eq("id", syncRunId)
    for (let index = 0; index < rows.length; index += 100) {
      const staged = await supabase.from("kfsp_rating_staging").insert(rows.slice(index, index + 100))
      if (staged.error) throw new Error(`KFSP_STAGING_WRITE_FAILED:${staged.error.code || "unknown"}`)
    }

    const published = await supabase.rpc("publish_kfsp_rating_snapshot", { p_sync_run_id: syncRunId, p_minimum_rows: canonicalTickers.length })
    if (published.error) throw new Error(`KFSP_SNAPSHOT_PUBLISH_FAILED:${published.error.code || "unknown"}`)
    const publishedCount = Number(published.data || rows.length)

    await finalizeManualKfspLifecycle(supabase, {
      context: manualContext,
      success: true,
      summary: {
        as_of_date: asOfDate,
        published_count: publishedCount,
        universe_count: canonicalTickers.length,
        provider_candidate_count: providerRows.length,
        token_refreshed: tokenRefreshed,
        contract_version: KFSP_CONTRACT_VERSION,
      },
    })

    return jsonResponse({
      ok: true,
      sync_run_id: syncRunId,
      as_of_date: asOfDate,
      published_count: publishedCount,
      universe_count: canonicalTickers.length,
      provider_candidate_count: providerRows.length,
      token_refreshed: tokenRefreshed,
      contract_version: KFSP_CONTRACT_VERSION,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "KFSP_SYNC_FAILED"
    const publicMessage = "KFSP daily rating sync failed; inspect Edge Function logs for provider diagnostics."
    await supabase.from("kfsp_rating_sync_runs").update({ status: "failed", token_refreshed: tokenRefreshed, error_code: message.slice(0, 120), error_message: publicMessage, completed_at: new Date().toISOString() }).eq("id", syncRunId)
    try {
      await finalizeManualKfspLifecycle(supabase, {
        context: manualContext,
        success: false,
        summary: { as_of_date: asOfDate, token_refreshed: tokenRefreshed },
        errorCode: message.slice(0, 100),
        errorMessage: publicMessage,
      })
    } catch (lifecycleError) {
      console.error("KFSP manual lifecycle failure finalization failed", lifecycleError instanceof Error ? lifecycleError.message : "unknown")
    }
    return jsonResponse({ ok: false, sync_run_id: syncRunId, error: message.slice(0, 120) }, 502)
  }
})