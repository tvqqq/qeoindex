import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { getKfspProviderToken } from "../_shared/kfsp-provider-auth.ts"
import {
  beginManualKfspLifecycle,
  finalizeManualKfspLifecycle,
  manualKfspRequestId,
  type ManualKfspContext,
} from "../_shared/kfsp-manual-lifecycle.ts"
import { isTtaiNoHistoryError, normalizeTtaiHistory } from "./normalize.ts"

type JsonObject = Record<string, unknown>

const PROVIDER_TIMEOUT_MS = 8_000
const LOGIN_URL = Deno.env.get("KFSP_LOGIN_URL") || "https://api.kfsp.vn/api/login"
const HISTORY_URL = Deno.env.get("KFSP_FUNDAMENTAL_HISTORY_URL") || "https://api.kfsp.vn/api/stocks/chart/fourm-canslim-point-chart"
const DEFAULT_MAX_PER_RUN = 12
const CONCURRENCY = 3
const KFSP_AUTH_OPTIONS = { loginUrl: LOGIN_URL, timeoutMs: PROVIDER_TIMEOUT_MS, persistLogin: false } as const

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
  const providerResponse = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) })
  const payload = await providerResponse.json().catch(() => null)
  return { response: providerResponse, payload }
}

function currentFinancialPeriod(metrics: unknown) {
  const root = asObject(metrics)
  const fundamentals = asObject(root?.fundamentals)
  const value = fundamentals?.financial_period
  return value == null ? null : String(value).trim() || null
}

async function loadCanonicalTickers(supabase: SupabaseClient) {
  const current = await supabase.rpc("qeo_current_market_universe", { p_universe_key: "vn_top_stocks" })
  if (current.error) throw new Error("KFSP_TTAI_UNIVERSE_READ_FAILED")
  const payload = asObject(Array.isArray(current.data) ? current.data[0] : current.data)
  const stocks = Array.isArray(payload?.stocks) ? payload.stocks : []
  const tickers = stocks
    .map((item) => String(asObject(item)?.ticker || "").trim().toUpperCase())
    .filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker))
  if (!tickers.length || tickers.length > 200 || new Set(tickers).size !== tickers.length) throw new Error(`KFSP_TTAI_UNIVERSE_INVALID:${tickers.length}`)
  const selectedCount = Number(payload?.selectedCount)
  if (Number.isFinite(selectedCount) && selectedCount !== tickers.length) throw new Error(`KFSP_TTAI_UNIVERSE_COUNT_MISMATCH:${selectedCount}:${tickers.length}`)
  return tickers
}

async function loadLatestRatingRows(supabase: SupabaseClient, latestDate: string, tickers: string[]) {
  const rows: Array<{ ticker: string; kfsp_metrics: unknown }> = []
  for (let offset = 0; offset < tickers.length; offset += 100) {
    const page = await supabase
      .from("insights_stock_ratings")
      .select("ticker,kfsp_metrics")
      .eq("is_published", true)
      .eq("source", "kfsp")
      .eq("as_of_date", latestDate)
      .in("ticker", tickers.slice(offset, offset + 100))
    if (page.error) throw new Error("KFSP_TTAI_RATING_READ_FAILED")
    rows.push(...(page.data || []))
  }
  return rows
}

async function loadSyncState(supabase: SupabaseClient) {
  const state = new Map<string, string | null>()
  for (let from = 0; ; from += 1000) {
    const page = await supabase.from("kfsp_ttai_sync_state").select("ticker,financial_period").order("ticker").range(from, from + 999)
    if (page.error) throw new Error("KFSP_TTAI_STATE_READ_FAILED")
    for (const row of page.data || []) state.set(String(row.ticker), row.financial_period == null ? null : String(row.financial_period))
    if ((page.data || []).length < 1000) break
  }
  return state
}

async function fetchTickerHistory(token: string, ticker: string) {
  const url = new URL(HISTORY_URL)
  url.searchParams.set("mack", ticker)
  url.searchParams.set("token", token)
  return fetchJson(url.toString(), { method: "GET", headers: { Accept: "application/json, text/plain, */*", Origin: "https://kfsp.vn", Referer: "https://kfsp.vn/" } })
}

function databaseErrorCode(error: { code?: string } | null) { return error?.code ? String(error.code).slice(0, 40) : "UNKNOWN" }

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405)
  const expectedSecret = Deno.env.get("KFSP_SYNC_SECRET") || ""
  const providedSecret = req.headers.get("x-kfsp-sync-secret") || ""
  if (!expectedSecret) return response({ ok: false, error: "SYNC_SECRET_NOT_CONFIGURED" }, 503)
  if (!constantTimeEqual(expectedSecret, providedSecret)) return response({ ok: false, error: "UNAUTHORIZED" }, 401)

  const requestBody = asObject(await req.json().catch(() => null))
  let manualRequestId: string | null = null
  try {
    manualRequestId = manualKfspRequestId(requestBody)
  } catch {
    return response({ ok: false, error: "KFSP_MANUAL_REQUEST_ID_INVALID" }, 400)
  }

  const requestedTickers = new Set((Array.isArray(requestBody?.tickers) ? requestBody.tickers : [])
    .map((value) => String(value || "").trim().toUpperCase()).filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker)))
  const forceRequested = requestBody?.force === true && requestedTickers.size > 0

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || ""
  const supabaseKey = serviceRoleKey()
  if (!supabaseUrl || !supabaseKey) return response({ ok: false, error: "SUPABASE_NOT_CONFIGURED" }, 500)
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const runId = manualRequestId ?? crypto.randomUUID()
  let manualContext: ManualKfspContext | null = null
  const started = await supabase.from("kfsp_ttai_sync_runs").insert({ id: runId, status: "running" })
  if (started.error) {
    if (manualRequestId && String(started.error.code || "") === "23505") {
      const existing = await supabase.from("kfsp_ttai_sync_runs").select("status,processed_count,failed_count,error_message").eq("id", runId).maybeSingle()
      const status = String(existing.data?.status || "running")
      return response({
        ok: status === "completed",
        duplicate: true,
        sync_run_id: runId,
        status,
        processed: Number(existing.data?.processed_count || 0),
        failed: Number(existing.data?.failed_count || 0),
      }, status === "running" ? 202 : 200)
    }
    return response({ ok: false, error: "KFSP_TTAI_RUN_CREATE_FAILED" }, 500)
  }

  try {
    const lifecycle = await beginManualKfspLifecycle(supabase, {
      requestBody,
      jobKey: "kfsp.ttai_history",
      syncRunId: runId,
    })
    manualContext = lifecycle.context
    if (lifecycle.duplicate) {
      return response({ ok: lifecycle.status === "succeeded", duplicate: true, sync_run_id: runId, status: lifecycle.status || "running" }, lifecycle.status === "running" ? 202 : 200)
    }

    const canonicalTickers = await loadCanonicalTickers(supabase)
    const canonicalSet = new Set(canonicalTickers)
    const selectedTickers = requestedTickers.size ? [...requestedTickers].filter((ticker) => canonicalSet.has(ticker)) : canonicalTickers
    if (!selectedTickers.length) throw new Error("KFSP_TTAI_REQUEST_OUTSIDE_UNIVERSE")
    const latest = await supabase.from("insights_stock_ratings").select("as_of_date").eq("is_published", true).eq("source", "kfsp").in("ticker", selectedTickers).order("as_of_date", { ascending: false }).limit(1).maybeSingle()
    if (latest.error || !latest.data?.as_of_date) throw new Error("KFSP_TTAI_LATEST_RATING_MISSING")
    const latestDate = String(latest.data.as_of_date)
    const [ratings, state] = await Promise.all([loadLatestRatingRows(supabase, latestDate, selectedTickers), loadSyncState(supabase)])
    const maxPerRun = Math.max(1, Math.min(50, Number(Deno.env.get("KFSP_TTAI_MAX_PER_RUN") || DEFAULT_MAX_PER_RUN)))
    const rank = new Map(canonicalTickers.map((ticker, index) => [ticker, index + 1]))
    const candidates = ratings
      .map((row) => ({ ...row, financialPeriod: currentFinancialPeriod(row.kfsp_metrics) }))
      .filter((row) => forceRequested || (row.financialPeriod && state.get(row.ticker) !== row.financialPeriod))
      .sort((left, right) => (rank.get(left.ticker) ?? 999) - (rank.get(right.ticker) ?? 999) || left.ticker.localeCompare(right.ticker))
      .slice(0, requestedTickers.size > 0 ? Math.min(50, requestedTickers.size) : maxPerRun)

    await supabase.from("kfsp_ttai_sync_runs").update({ latest_rating_date: latestDate, candidate_count: candidates.length }).eq("id", runId)
    if (!candidates.length) {
      await supabase.from("kfsp_ttai_sync_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", runId)
      await finalizeManualKfspLifecycle(supabase, {
        context: manualContext,
        success: true,
        summary: { latest_rating_date: latestDate, candidate_count: 0, processed: 0, failed: 0, skipped: 0, reason: "NO_NEW_FINANCIAL_PERIOD", universe_count: canonicalTickers.length },
      })
      return response({ ok: true, sync_run_id: runId, latest_rating_date: latestDate, processed: 0, failed: 0, skipped: 0, reason: "NO_NEW_FINANCIAL_PERIOD" })
    }

    let auth = await getKfspProviderToken(supabase, KFSP_AUTH_OPTIONS)
    let token = auth.token
    let processed = 0, failed = 0, skipped = 0
    for (let index = 0; index < candidates.length; index += CONCURRENCY) {
      const batch = candidates.slice(index, index + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(async (candidate) => {
        let fetched = await fetchTickerHistory(token, candidate.ticker)
        if (fetched.response.status === 401 || fetched.response.status === 403) {
          auth = await getKfspProviderToken(supabase, KFSP_AUTH_OPTIONS, true)
          token = auth.token
          fetched = await fetchTickerHistory(token, candidate.ticker)
        }
        if (!fetched.response.ok) throw new Error(`KFSP_TTAI_HTTP_${fetched.response.status}`)
        const fetchedAt = new Date().toISOString()
        let rows
        try { rows = normalizeTtaiHistory(candidate.ticker, fetched.payload, fetchedAt) }
        catch (error) {
          if (!isTtaiNoHistoryError(error)) throw error
          const stateWrite = await supabase.from("kfsp_ttai_sync_state").upsert({ ticker: candidate.ticker, financial_period: candidate.financialPeriod, latest_provider_period: null, last_success_at: fetchedAt, last_error: null }, { onConflict: "ticker" })
          if (stateWrite.error) throw new Error(`KFSP_TTAI_STATE_WRITE_FAILED:${databaseErrorCode(stateWrite.error)}`)
          return { kind: "skipped" as const }
        }
        const upserted = await supabase.from("kfsp_ttai_quarterly_history").upsert(rows, { onConflict: "ticker,period" })
        if (upserted.error) throw new Error(`KFSP_TTAI_HISTORY_WRITE_FAILED:${databaseErrorCode(upserted.error)}`)
        const latestProviderPeriod = rows.at(-1)?.period ?? null
        const stateWrite = await supabase.from("kfsp_ttai_sync_state").upsert({ ticker: candidate.ticker, financial_period: candidate.financialPeriod, latest_provider_period: latestProviderPeriod, last_success_at: fetchedAt, last_error: null }, { onConflict: "ticker" })
        if (stateWrite.error) throw new Error(`KFSP_TTAI_STATE_WRITE_FAILED:${databaseErrorCode(stateWrite.error)}`)
        return { kind: "processed" as const }
      }))
      for (let offset = 0; offset < results.length; offset += 1) {
        const result = results[offset]
        const candidate = batch[offset]
        if (result.status === "fulfilled") result.value.kind === "skipped" ? skipped += 1 : processed += 1
        else {
          failed += 1
          const message = result.reason instanceof Error ? result.reason.message : "KFSP_TTAI_SYNC_FAILED"
          await supabase.from("kfsp_ttai_sync_state").upsert({ ticker: candidate.ticker, last_error: message.slice(0, 120) }, { onConflict: "ticker" })
        }
      }
    }

    const terminalMessage = failed ? `${failed} ticker(s) failed; inspect kfsp_ttai_sync_state.last_error for per-ticker cause.` : null
    await supabase.from("kfsp_ttai_sync_runs").update({ status: failed ? "failed" : "completed", processed_count: processed, failed_count: failed, error_message: terminalMessage, completed_at: new Date().toISOString() }).eq("id", runId)
    const terminalSummary = { latest_rating_date: latestDate, candidate_count: candidates.length, processed, failed, skipped, universe_count: canonicalTickers.length }
    await finalizeManualKfspLifecycle(supabase, {
      context: manualContext,
      success: failed === 0,
      summary: terminalSummary,
      errorCode: failed ? "KFSP_TTAI_PARTIAL_FAILURE" : null,
      errorMessage: terminalMessage,
    })
    return response({ ok: failed === 0, sync_run_id: runId, ...terminalSummary }, failed ? 207 : 200)
  } catch (error) {
    const message = error instanceof Error ? error.message : "KFSP_TTAI_SYNC_FAILED"
    const publicMessage = "KFSP TTAI sync failed; inspect Edge Function logs and per-ticker state for diagnostics."
    await supabase.from("kfsp_ttai_sync_runs").update({ status: "failed", error_message: message.slice(0, 200), completed_at: new Date().toISOString() }).eq("id", runId)
    try {
      await finalizeManualKfspLifecycle(supabase, {
        context: manualContext,
        success: false,
        summary: { requested_ticker_count: requestedTickers.size, force: forceRequested },
        errorCode: message.slice(0, 100),
        errorMessage: publicMessage,
      })
    } catch (lifecycleError) {
      console.error("KFSP TTAI manual lifecycle failure finalization failed", lifecycleError instanceof Error ? lifecycleError.message : "unknown")
    }
    return response({ ok: false, sync_run_id: runId, error: message.slice(0, 120) }, 502)
  }
})