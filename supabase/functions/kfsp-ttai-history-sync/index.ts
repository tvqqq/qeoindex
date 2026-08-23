import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"

type JsonObject = Record<string, unknown>
type HistoryRow = {
  ticker: string
  period: string
  period_year: number
  period_quarter: number
  fourm_score: number | null
  canslim_score: number | null
  fourm_components: Record<string, number>
  canslim_components: Record<string, number>
  fetched_at: string
}

const PROVIDER_TIMEOUT_MS = 8_000
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1_000
const LOGIN_URL = Deno.env.get("KFSP_LOGIN_URL") || "https://api.kfsp.vn/api/login"
const HISTORY_URL = Deno.env.get("KFSP_FUNDAMENTAL_HISTORY_URL") || "https://api.kfsp.vn/api/stocks/chart/fourm-canslim-point-chart"
const PAGE_SIZE = 1000
const DEFAULT_MAX_PER_RUN = 12
const CONCURRENCY = 3

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null
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
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0)
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
  const providerResponse = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  const payload = await providerResponse.json().catch(() => null)
  return { response: providerResponse, payload }
}

async function loginAndCacheToken(supabase: SupabaseClient) {
  const username = Deno.env.get("KFSP_USERNAME") || ""
  const password = Deno.env.get("KFSP_PASSWORD") || ""
  if (!username || !password) throw new Error("KFSP_CREDENTIALS_MISSING")
  const login = await fetchJson(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password, persist_login: false }),
  })
  if (!login.response.ok) throw new Error(`KFSP_LOGIN_HTTP_${login.response.status}`)
  const token = extractToken(login.payload)
  const expiresAt = token ? decodeTokenExpiry(token) : null
  if (!token || !expiresAt) throw new Error("KFSP_LOGIN_TOKEN_INVALID")
  const cached = await supabase.from("kfsp_provider_tokens").upsert({
    provider: "kfsp",
    access_token: token,
    expires_at: expiresAt.toISOString(),
    refreshed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider" })
  if (cached.error) throw new Error("KFSP_TOKEN_CACHE_WRITE_FAILED")
  return token
}

async function getProviderToken(supabase: SupabaseClient, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await supabase.from("kfsp_provider_tokens").select("access_token,expires_at").eq("provider", "kfsp").maybeSingle()
    if (!cached.error && cached.data?.access_token && cached.data.expires_at) {
      const expiry = new Date(cached.data.expires_at).getTime()
      if (Number.isFinite(expiry) && expiry - Date.now() > TOKEN_EXPIRY_SKEW_MS) return String(cached.data.access_token)
    }
  }
  return loginAndCacheToken(supabase)
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const parsed = Number(value.trim().replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

function periodParts(period: string) {
  const match = /^Q([1-4])\.(\d{2})$/.exec(period)
  if (!match) return null
  return { quarter: Number(match[1]), year: 2000 + Number(match[2]) }
}

function comparePeriods(left: string, right: string) {
  const a = periodParts(left)
  const b = periodParts(right)
  if (!a || !b) return left.localeCompare(right)
  return a.year - b.year || a.quarter - b.quarter
}

function parseHistorySeries(option: unknown) {
  const root = asObject(option)
  const xAxis = asObject(root?.xAxis)
  const periods = Array.isArray(xAxis?.data) ? xAxis.data.map(String) : []
  const series = Array.isArray(root?.series) ? root.series : []
  const firstSeries = asObject(series[0])
  const values = Array.isArray(firstSeries?.data) ? firstSeries.data : []
  const result = new Map<string, number>()
  for (let index = 0; index < Math.min(periods.length, values.length); index += 1) {
    const value = numeric(values[index])
    if (periodParts(periods[index]) && value != null) result.set(periods[index], value)
  }
  return result
}

function parseComponentTable(table: unknown) {
  if (!Array.isArray(table) || !Array.isArray(table[0])) return new Map<string, Record<string, number>>()
  const header = (table[0] as unknown[]).slice(1).map(String)
  const periods = header.filter((item) => periodParts(item))
  const result = new Map<string, Record<string, number>>()
  for (const rawRow of table.slice(1)) {
    if (!Array.isArray(rawRow) || rawRow.length < 2) continue
    const label = String(rawRow[0] || "").trim()
    if (!label) continue
    const values = rawRow.slice(1)
    // KFSP currently returns 28 values for 4M against 30 headers. Right alignment
    // is intentional: the final values match the latest radar/current quarter.
    const offset = Math.max(0, periods.length - values.length)
    values.forEach((rawValue, index) => {
      const period = periods[offset + index]
      const value = numeric(rawValue)
      if (!period || value == null) return
      const bucket = result.get(period) || {}
      bucket[label] = value
      result.set(period, bucket)
    })
  }
  return result
}

function parseCurrentRadar(option: unknown) {
  const root = asObject(option)
  const radar = asObject(root?.radar)
  const indicators = Array.isArray(radar?.indicator) ? radar.indicator : []
  const series = Array.isArray(root?.series) ? root.series : []
  const firstSeries = asObject(series[0])
  const firstData = Array.isArray(firstSeries?.data) ? firstSeries.data[0] : null
  const values = Array.isArray(firstData) ? firstData : []
  const result: Record<string, number> = {}
  indicators.forEach((indicator, index) => {
    const name = String(asObject(indicator)?.name || "").trim()
    const value = numeric(values[index])
    if (name && value != null) result[name] = value
  })
  return result
}

export function normalizeTtaiHistory(ticker: string, payload: unknown, fetchedAt: string): HistoryRow[] {
  const root = asObject(payload)
  if (!root) throw new Error("KFSP_TTAI_RESPONSE_INVALID")
  const fourmScores = parseHistorySeries(root.fourm_option_history_chart)
  const canslimScores = parseHistorySeries(root.canslim_option_history_chart)
  const fourmComponents = parseComponentTable(root.data_table_4m)
  const canslimComponents = parseComponentTable(root.data_table_canslim)
  const periods = [...new Set([
    ...fourmScores.keys(), ...canslimScores.keys(), ...fourmComponents.keys(), ...canslimComponents.keys(),
  ])].filter((period) => periodParts(period)).sort(comparePeriods)
  if (!periods.length) throw new Error("KFSP_TTAI_PERIODS_MISSING")

  const latestPeriod = periods.at(-1)!
  const currentFourm = numeric(root.fourm_point)
  const currentCanslim = numeric(root.canslim_point)
  if (currentFourm != null) fourmScores.set(latestPeriod, currentFourm)
  if (currentCanslim != null) canslimScores.set(latestPeriod, currentCanslim)

  const latestFourmRadar = parseCurrentRadar(root.fourm_option_chart)
  const latestCanslimRadar = parseCurrentRadar(root.canslim_option_chart)
  if (Object.keys(latestFourmRadar).length) fourmComponents.set(latestPeriod, latestFourmRadar)
  if (Object.keys(latestCanslimRadar).length) canslimComponents.set(latestPeriod, latestCanslimRadar)

  return periods.map((period) => {
    const parts = periodParts(period)!
    return {
      ticker,
      period,
      period_year: parts.year,
      period_quarter: parts.quarter,
      fourm_score: fourmScores.get(period) ?? null,
      canslim_score: canslimScores.get(period) ?? null,
      fourm_components: fourmComponents.get(period) || {},
      canslim_components: canslimComponents.get(period) || {},
      fetched_at: fetchedAt,
    }
  })
}

function currentFinancialPeriod(metrics: unknown) {
  const root = asObject(metrics)
  const fundamentals = asObject(root?.fundamentals)
  const value = fundamentals?.financial_period
  return value == null ? null : String(value).trim() || null
}

async function loadLatestRatingRows(supabase: SupabaseClient, latestDate: string) {
  const rows: Array<{ ticker: string; is_top100: boolean; kfsp_metrics: unknown }> = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabase
      .from("insights_stock_ratings")
      .select("ticker,is_top100,kfsp_metrics")
      .eq("is_published", true)
      .eq("source", "kfsp")
      .eq("as_of_date", latestDate)
      .order("ticker", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (page.error) throw new Error("KFSP_TTAI_RATING_READ_FAILED")
    rows.push(...(page.data || []))
    if ((page.data || []).length < PAGE_SIZE) break
  }
  return rows
}

async function loadSyncState(supabase: SupabaseClient) {
  const state = new Map<string, string | null>()
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await supabase.from("kfsp_ttai_sync_state").select("ticker,financial_period").order("ticker").range(from, from + PAGE_SIZE - 1)
    if (page.error) throw new Error("KFSP_TTAI_STATE_READ_FAILED")
    for (const row of page.data || []) state.set(String(row.ticker), row.financial_period == null ? null : String(row.financial_period))
    if ((page.data || []).length < PAGE_SIZE) break
  }
  return state
}

async function fetchTickerHistory(token: string, ticker: string) {
  const url = new URL(HISTORY_URL)
  url.searchParams.set("mack", ticker)
  url.searchParams.set("token", token)
  return fetchJson(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json, text/plain, */*", Origin: "https://kfsp.vn", Referer: "https://kfsp.vn/" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
  const expectedSecret = Deno.env.get("KFSP_SYNC_SECRET") || ""
  const providedSecret = req.headers.get("x-kfsp-sync-secret") || ""
  if (!expectedSecret) return response({ ok: false, error: "SYNC_SECRET_NOT_CONFIGURED" }, 503)
  if (!constantTimeEqual(expectedSecret, providedSecret)) return response({ ok: false, error: "UNAUTHORIZED" }, 401)

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const supabaseKey = serviceRoleKey()
  if (!supabaseUrl || !supabaseKey) return response({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, 500)
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const runId = crypto.randomUUID()
  const started = await supabase.from("kfsp_ttai_sync_runs").insert({ id: runId, status: "running" })
  if (started.error) return response({ ok: false, error: "KFSP_TTAI_RUN_CREATE_FAILED" }, 500)

  try {
    const latest = await supabase.from("insights_stock_ratings").select("as_of_date").eq("is_published", true).eq("source", "kfsp").order("as_of_date", { ascending: false }).limit(1).maybeSingle()
    if (latest.error || !latest.data?.as_of_date) throw new Error("KFSP_TTAI_LATEST_RATING_MISSING")
    const latestDate = String(latest.data.as_of_date)
    const [ratings, state] = await Promise.all([loadLatestRatingRows(supabase, latestDate), loadSyncState(supabase)])
    const maxPerRun = Math.max(1, Math.min(50, Number(Deno.env.get("KFSP_TTAI_MAX_PER_RUN") || DEFAULT_MAX_PER_RUN)))
    const candidates = ratings
      .map((row) => ({ ...row, financialPeriod: currentFinancialPeriod(row.kfsp_metrics) }))
      .filter((row) => row.financialPeriod && state.get(row.ticker) !== row.financialPeriod)
      .sort((left, right) => Number(right.is_top100) - Number(left.is_top100) || left.ticker.localeCompare(right.ticker))
      .slice(0, maxPerRun)

    await supabase.from("kfsp_ttai_sync_runs").update({ latest_rating_date: latestDate, candidate_count: candidates.length }).eq("id", runId)
    if (!candidates.length) {
      await supabase.from("kfsp_ttai_sync_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", runId)
      return response({ ok: true, sync_run_id: runId, latest_rating_date: latestDate, processed: 0, reason: "NO_NEW_FINANCIAL_PERIOD" })
    }

    let token = await getProviderToken(supabase)
    let processed = 0
    let failed = 0
    for (let index = 0; index < candidates.length; index += CONCURRENCY) {
      const batch = candidates.slice(index, index + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(async (candidate) => {
        let fetched = await fetchTickerHistory(token, candidate.ticker)
        if (fetched.response.status === 401 || fetched.response.status === 403) {
          token = await getProviderToken(supabase, true)
          fetched = await fetchTickerHistory(token, candidate.ticker)
        }
        if (!fetched.response.ok) throw new Error(`KFSP_TTAI_HTTP_${fetched.response.status}`)
        const fetchedAt = new Date().toISOString()
        const rows = normalizeTtaiHistory(candidate.ticker, fetched.payload, fetchedAt)
        const upserted = await supabase.from("kfsp_ttai_quarterly_history").upsert(rows, { onConflict: "ticker,period" })
        if (upserted.error) throw new Error("KFSP_TTAI_HISTORY_WRITE_FAILED")
        const latestProviderPeriod = rows.at(-1)?.period ?? null
        const stateWrite = await supabase.from("kfsp_ttai_sync_state").upsert({
          ticker: candidate.ticker,
          financial_period: candidate.financialPeriod,
          latest_provider_period: latestProviderPeriod,
          last_success_at: fetchedAt,
          last_error: null,
        }, { onConflict: "ticker" })
        if (stateWrite.error) throw new Error("KFSP_TTAI_STATE_WRITE_FAILED")
      }))
      for (let offset = 0; offset < results.length; offset += 1) {
        const result = results[offset]
        const candidate = batch[offset]
        if (result.status === "fulfilled") {
          processed += 1
        } else {
          failed += 1
          const message = result.reason instanceof Error ? result.reason.message : "KFSP_TTAI_SYNC_FAILED"
          await supabase.from("kfsp_ttai_sync_state").upsert({ ticker: candidate.ticker, last_error: message.slice(0, 120) }, { onConflict: "ticker" })
        }
      }
    }

    await supabase.from("kfsp_ttai_sync_runs").update({
      status: failed ? "failed" : "completed",
      processed_count: processed,
      failed_count: failed,
      error_message: failed ? `${failed} ticker(s) failed; they remain eligible for retry.` : null,
      completed_at: new Date().toISOString(),
    }).eq("id", runId)

    return response({ ok: failed === 0, sync_run_id: runId, latest_rating_date: latestDate, processed, failed, candidate_count: candidates.length }, failed ? 207 : 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : "KFSP_TTAI_SYNC_FAILED"
    await supabase.from("kfsp_ttai_sync_runs").update({ status: "failed", error_message: message.slice(0, 200), completed_at: new Date().toISOString() }).eq("id", runId)
    return response({ ok: false, sync_run_id: runId, error: message.slice(0, 120) }, 502)
  }
})
