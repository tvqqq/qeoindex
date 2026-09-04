import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { runQeoIndexEodPhase } from "@/modules/admin/job-phase-telemetry"
import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { vietnamDateKey } from "@/modules/market/calendar"

const TTAI_BATCH_SIZE = 50
const KFSP_EDGE_TIMEOUT_MS = 180_000

type JsonObject = Record<string, unknown>

export interface FrozenEodUniverse {
  runId: string
  tickers: string[]
  selectedCount: number
  sourceAsOfDate: string
}

export interface TtaiRefreshProgress {
  status: "fresh" | "degraded"
  latestRatingDate: string
  syncRunIds: string[]
  processed: number
  failed: number
  skipped: number
  failedTickers: string[]
  checkedTickers: number
}

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function normalizeTicker(value: unknown) {
  return String(value || "").trim().toUpperCase()
}

function uniqueSortedTickers(values: unknown[]) {
  return [...new Set(values.map(normalizeTicker).filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker)))].sort()
}

function membershipDiff(expected: string[], actual: string[]) {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  return {
    missing: expected.filter((ticker) => !actualSet.has(ticker)),
    unexpected: actual.filter((ticker) => !expectedSet.has(ticker)),
  }
}

function currentFinancialPeriod(metrics: unknown) {
  const root = asObject(metrics)
  const fundamentals = asObject(root?.fundamentals)
  const value = fundamentals?.financial_period
  return value == null ? null : String(value).trim() || null
}

function supabaseFunctionsBaseUrl() {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || "https://glwhhrmejlonhyorvtzm.supabase.co"
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1`
}

async function loadKfspSyncSecret(supabase: SupabaseClient) {
  const secretResult = await supabase.rpc("qeo_get_market_close_sync_secret")
  const syncSecret = typeof secretResult.data === "string" ? secretResult.data.trim() : ""
  if (secretResult.error || !syncSecret) {
    throw Object.assign(
      new Error(`KFSP refresh failed to load Vault sync secret: ${secretResult.error?.message || "missing secret"}`),
      { code: "KFSP_REFRESH_SECRET_UNAVAILABLE" },
    )
  }
  return syncSecret
}

async function invokeKfspEdgeFunction(
  functionName: "kfsp-rating-sync" | "kfsp-ttai-history-sync",
  syncSecret: string,
  body: JsonObject,
) {
  const response = await fetch(`${supabaseFunctionsBaseUrl()}/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kfsp-sync-secret": syncSecret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(KFSP_EDGE_TIMEOUT_MS),
  }).catch((error) => ({
    ok: false,
    status: 500,
    json: async () => ({ error: error instanceof Error ? error.message : String(error) }),
  } as unknown as Response))

  const payload = await response.json().catch(() => ({})) as JsonObject
  return { response, payload }
}

async function publishedRatingTickers(supabase: SupabaseClient, sessionDate: string) {
  const query = await supabase
    .from("insights_stock_ratings")
    .select("ticker")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("as_of_date", sessionDate)
  if (query.error) throw new Error(`Load published KFSP rating membership failed: ${query.error.message}`)
  return uniqueSortedTickers((query.data || []).map((row) => row.ticker))
}

async function staleTtaiTickers(supabase: SupabaseClient, sessionDate: string, tickers: string[]) {
  if (!tickers.length) return []
  const [ratings, state] = await Promise.all([
    supabase
      .from("insights_stock_ratings")
      .select("ticker,kfsp_metrics")
      .eq("is_published", true)
      .eq("source", "kfsp")
      .eq("as_of_date", sessionDate)
      .in("ticker", tickers),
    supabase
      .from("kfsp_ttai_sync_state")
      .select("ticker,financial_period,last_error")
      .in("ticker", tickers),
  ])
  if (ratings.error) throw new Error(`Load TTAI rating periods failed: ${ratings.error.message}`)
  if (state.error) throw new Error(`Load TTAI sync state failed: ${state.error.message}`)

  const stateByTicker = new Map(
    (state.data || []).map((row) => [normalizeTicker(row.ticker), {
      financialPeriod: row.financial_period == null ? null : String(row.financial_period),
      lastError: row.last_error == null ? null : String(row.last_error),
    }]),
  )
  const periodByTicker = new Map(
    (ratings.data || []).map((row) => [normalizeTicker(row.ticker), currentFinancialPeriod(row.kfsp_metrics)]),
  )

  return tickers.filter((ticker) => {
    const expectedPeriod = periodByTicker.get(ticker) ?? null
    if (!expectedPeriod) return false
    const currentState = stateByTicker.get(ticker)
    return !currentState
      || currentState.financialPeriod !== expectedPeriod
      || Boolean(currentState.lastError)
  })
}

async function ensureFrozenUniverseStillCurrent(expectedUniverse: FrozenEodUniverse) {
  const universe = await getCanonicalUniverse()
  const currentTickers = universe.stocks.map((stock) => stock.ticker)
  const { missing, unexpected } = membershipDiff(expectedUniverse.tickers, currentTickers)
  if (
    universe.runId !== expectedUniverse.runId
    || universe.selectedCount !== expectedUniverse.selectedCount
    || missing.length > 0
    || unexpected.length > 0
  ) {
    throw Object.assign(
      new Error(
        `Canonical universe changed during EOD refresh: run ${universe.runId} != ${expectedUniverse.runId}`
        + `${missing.length ? `; missing=${missing.slice(0, 20).join(",")}` : ""}`
        + `${unexpected.length ? `; unexpected=${unexpected.slice(0, 20).join(",")}` : ""}`,
      ),
      { code: "CANONICAL_UNIVERSE_CHANGED" },
    )
  }
  return expectedUniverse
}

export async function assertFrozenUniverseStillCurrent(expectedUniverse: FrozenEodUniverse) {
  "use step"
  return ensureFrozenUniverseStillCurrent(expectedUniverse)
}

export async function assertReadyMatchesFrozenUniverse(input: {
  readyUniverseRunId: string
  readyTickers: string[]
  expectedUniverse: FrozenEodUniverse
}) {
  "use step"
  const readyTickers = uniqueSortedTickers(input.readyTickers)
  const expectedTickers = uniqueSortedTickers(input.expectedUniverse.tickers)
  const { missing, unexpected } = membershipDiff(expectedTickers, readyTickers)
  if (
    input.readyUniverseRunId !== input.expectedUniverse.runId
    || readyTickers.length !== expectedTickers.length
    || missing.length > 0
    || unexpected.length > 0
  ) {
    throw Object.assign(
      new Error(
        `EOD_READY frozen universe mismatch: run ${input.readyUniverseRunId} != ${input.expectedUniverse.runId}`
        + `${missing.length ? `; missing=${missing.slice(0, 20).join(",")}` : ""}`
        + `${unexpected.length ? `; unexpected=${unexpected.slice(0, 20).join(",")}` : ""}`,
      ),
      { code: "CANONICAL_UNIVERSE_CHANGED" },
    )
  }
  return input.expectedUniverse
}

export async function runKfspRatingRefreshStep(runId: string, startedAtIso: string) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "KFSP_RATING_REFRESH",
    fn: async () => {
      const supabase = requiredSupabase()
      const sessionDate = vietnamDateKey(startedAtIso)
      const syncSecret = await loadKfspSyncSecret(supabase)
      const { response, payload } = await invokeKfspEdgeFunction(
        "kfsp-rating-sync",
        syncSecret,
        { source: "qeoindex_eod_pipeline", session_date: sessionDate },
      )
      if (!response.ok || payload.ok === false) {
        throw Object.assign(
          new Error(`KFSP_RATING_REFRESH failed: ${String(payload.error || `HTTP_${response.status}`)}`),
          { code: "KFSP_RATING_REFRESH_FAILED", status: response.status },
        )
      }

      const ratingDate = String(payload.as_of_date || "")
      if (ratingDate !== sessionDate) {
        throw Object.assign(
          new Error(`KFSP Rating refresh date ${ratingDate || "missing"} != EOD session ${sessionDate}`),
          { code: "KFSP_RATING_REFRESH_STALE" },
        )
      }

      const canonical = await getCanonicalUniverse()
      const universe: FrozenEodUniverse = {
        runId: canonical.runId,
        tickers: canonical.stocks.map((stock) => stock.ticker),
        selectedCount: canonical.selectedCount,
        sourceAsOfDate: canonical.sourceAsOfDate,
      }
      const publishedTickers = await publishedRatingTickers(supabase, sessionDate)
      const { missing: missingRatings, unexpected: unexpectedRatings } = membershipDiff(universe.tickers, publishedTickers)
      const publishedCount = Number(payload.published_count || 0)
      const universeCount = Number(payload.universe_count || 0)
      if (
        publishedCount !== universe.selectedCount
        || universeCount !== universe.selectedCount
        || publishedTickers.length !== universe.selectedCount
        || missingRatings.length > 0
        || unexpectedRatings.length > 0
      ) {
        throw Object.assign(
          new Error(
            `KFSP Rating membership mismatch ${publishedTickers.length}/${universe.selectedCount}`
            + `${missingRatings.length ? `; missing=${missingRatings.slice(0, 20).join(",")}` : ""}`
            + `${unexpectedRatings.length ? `; unexpected=${unexpectedRatings.slice(0, 20).join(",")}` : ""}`,
          ),
          { code: "KFSP_RATING_REFRESH_MEMBERSHIP_MISMATCH" },
        )
      }

      return {
        status: "fresh" as const,
        sessionDate,
        ratingDate,
        syncRunId: String(payload.sync_run_id || ""),
        publishedCount,
        providerCandidateCount: Number(payload.provider_candidate_count || 0),
        publishedTickers,
        missingRatings,
        unexpectedRatings,
        universe,
        universeRunId: universe.runId,
      }
    },
    summarize: (result) => ({
      status: result.status,
      sessionDate: result.sessionDate,
      ratingDate: result.ratingDate,
      syncRunId: result.syncRunId,
      publishedCount: result.publishedCount,
      providerCandidateCount: result.providerCandidateCount,
      universeRunId: result.universe.runId,
      universeCount: result.universe.selectedCount,
      missingRatings: result.missingRatings,
      unexpectedRatings: result.unexpectedRatings,
    }),
  })
}

export async function runTtaiRefreshStep(
  runId: string,
  startedAtIso: string,
  universe: FrozenEodUniverse,
  tickers: string[],
  progress?: TtaiRefreshProgress,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "TTAI_REFRESH",
    fn: async () => {
      const batchTickers = uniqueSortedTickers(tickers)
      if (!batchTickers.length || batchTickers.length > TTAI_BATCH_SIZE) {
        throw Object.assign(
          new Error(`TTAI_REFRESH batch must contain 1-${TTAI_BATCH_SIZE} tickers; received ${batchTickers.length}`),
          { code: "TTAI_REFRESH_BATCH_INVALID" },
        )
      }
      const outsideFrozen = batchTickers.filter((ticker) => !universe.tickers.includes(ticker))
      if (outsideFrozen.length) {
        throw Object.assign(
          new Error(`TTAI_REFRESH requested ticker outside frozen universe: ${outsideFrozen.slice(0, 20).join(",")}`),
          { code: "TTAI_REFRESH_BATCH_INVALID" },
        )
      }

      await ensureFrozenUniverseStillCurrent(universe)
      const supabase = requiredSupabase()
      const sessionDate = vietnamDateKey(startedAtIso)
      const syncSecret = await loadKfspSyncSecret(supabase)
      const { response, payload } = await invokeKfspEdgeFunction(
        "kfsp-ttai-history-sync",
        syncSecret,
        { source: "qeoindex_eod_pipeline", tickers: batchTickers },
      )
      if ((!response.ok || (payload.ok === false && response.status !== 207)) && response.status !== 207) {
        throw Object.assign(
          new Error(`TTAI_REFRESH failed: ${String(payload.error || `HTTP_${response.status}`)}`),
          { code: "TTAI_REFRESH_FAILED", status: response.status },
        )
      }

      const latestRatingDate = String(payload.latest_rating_date || "")
      if (latestRatingDate !== sessionDate) {
        throw Object.assign(
          new Error(`TTAI latest_rating_date ${latestRatingDate || "missing"} != EOD session ${sessionDate}`),
          { code: "TTAI_REFRESH_STALE" },
        )
      }

      const staleAfterRefresh = await staleTtaiTickers(supabase, sessionDate, batchTickers)
      await ensureFrozenUniverseStillCurrent(universe)
      const previous = progress || {
        status: "fresh" as const,
        latestRatingDate: sessionDate,
        syncRunIds: [],
        processed: 0,
        failed: 0,
        skipped: 0,
        failedTickers: [],
        checkedTickers: 0,
      }
      const providerFailed = Number(payload.failed || 0)
      const failedTickers = uniqueSortedTickers([...previous.failedTickers, ...staleAfterRefresh])
      return {
        status: failedTickers.length > 0 ? "degraded" as const : "fresh" as const,
        latestRatingDate,
        syncRunIds: [...previous.syncRunIds, String(payload.sync_run_id || "")].filter(Boolean),
        processed: previous.processed + Number(payload.processed || 0),
        failed: previous.failed + Math.max(providerFailed, staleAfterRefresh.length),
        skipped: previous.skipped + Number(payload.skipped || 0),
        failedTickers,
        checkedTickers: previous.checkedTickers + batchTickers.length,
      }
    },
    summarize: (result) => ({
      status: result.status,
      latest_rating_date: result.latestRatingDate,
      syncRunIds: result.syncRunIds,
      processed: result.processed,
      failed: result.failed,
      skipped: result.skipped,
      checkedTickers: result.checkedTickers,
      failedTickers: result.failedTickers.slice(0, 20),
      universeRunId: universe.runId,
    }),
  })
}
