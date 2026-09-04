import "server-only"

import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/modules/admin/job-phase-telemetry"
import { QEOINDEX_EOD_JOB_KEY } from "@/modules/admin/job-phases"
import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import { vietnamDateKey } from "@/modules/market/calendar"
import { loadWyckoffV2Universe } from "@/modules/wyckoff/eod-universe-source"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

async function assertFinalEodMarketReady(startedAtIso: string) {
  const supabase = requiredSupabase()
  const expectedSessionDate = vietnamDateKey(startedAtIso)
  const universe = await getCanonicalUniverse()
  const tickers = universe.stocks.map((stock) => stock.ticker)
  if (!tickers.length) {
    throw Object.assign(new Error("Canonical market universe is empty"), { code: "EOD_NOT_READY" })
  }

  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .in("ticker", tickers)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) throw new Error(`Load EOD rating date failed: ${latest.error.message}`)

  const ratingDate = latest.data?.as_of_date ? String(latest.data.as_of_date) : null
  if (ratingDate !== expectedSessionDate) {
    throw Object.assign(
      new Error(`KFSP/TTAI rating date ${ratingDate || "missing"} != EOD session ${expectedSessionDate}`),
      { code: "EOD_NOT_READY" },
    )
  }

  const ratings = await supabase
    .from("insights_stock_ratings")
    .select("ticker")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("as_of_date", expectedSessionDate)
    .in("ticker", tickers)
  if (ratings.error) throw new Error(`Load EOD canonical ratings failed: ${ratings.error.message}`)

  const ratingTickerSet = new Set(
    (ratings.data || [])
      .map((row) => String(row.ticker || "").trim().toUpperCase())
      .filter(Boolean),
  )
  const missingRatings = tickers.filter((ticker) => !ratingTickerSet.has(ticker))
  if (missingRatings.length) {
    throw Object.assign(
      new Error(
        `Canonical rating universe incomplete: ${tickers.length - missingRatings.length}/${tickers.length}`
        + `; missing=${missingRatings.slice(0, 20).join(",")}`,
      ),
      { code: "EOD_NOT_READY" },
    )
  }

  const snapshots = await supabase
    .from("stock_orderbook_snapshots")
    .select("symbol,session_date,updated_at")
    .eq("session_date", expectedSessionDate)
    .in("symbol", tickers)
  if (snapshots.error) throw new Error(`Load final EOD market snapshots failed: ${snapshots.error.message}`)

  const cutoff = new Date(`${expectedSessionDate}T07:45:00.000Z`).getTime()
  const fresh = new Set(
    (snapshots.data || [])
      .filter((row) => {
        if (String(row.session_date || "") !== expectedSessionDate || !row.updated_at) return false
        const updatedAt = new Date(String(row.updated_at)).getTime()
        return Number.isFinite(updatedAt) && updatedAt >= cutoff
      })
      .map((row) => String(row.symbol || "").trim().toUpperCase()),
  )
  if (fresh.size !== tickers.length) {
    throw Object.assign(
      new Error(`Final EOD market snapshots incomplete: ${fresh.size}/${tickers.length}`),
      { code: "EOD_NOT_READY" },
    )
  }

  return {
    expectedSessionDate,
    ratingDate,
    ratingTickers: tickers,
    freshMarketCount: fresh.size,
    universeRunId: universe.runId,
  }
}

export async function startQeoIndexEodRunStep(startedAtIso: string) {
  "use step"
  const result = await requiredSupabase().from("system_job_runs").insert({
    job_key: QEOINDEX_EOD_JOB_KEY,
    provider: "supabase_pg_cron",
    trigger: "workflow",
    status: "running",
    started_at: startedAtIso,
  }).select("id").single()
  if (result.error || !result.data?.id) {
    throw new Error(`QeoIndex EOD telemetry start failed: ${result.error?.message || "missing run id"}`)
  }
  return String(result.data.id)
}

export async function runEodReadyStep(runId: string, startedAtIso: string) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "EOD_READY",
    fn: async () => {
      const market = await assertFinalEodMarketReady(startedAtIso)
      const selection = await loadWyckoffV2Universe()
      const scanDate = market.expectedSessionDate
      const runKey = `WYCKOFF-${scanDate}-EOD-v4`
      if (selection.stocks.length !== market.ratingTickers.length) {
        throw Object.assign(
          new Error(`Canonical Wyckoff selection mismatch: ${selection.stocks.length}/${market.ratingTickers.length}`),
          { code: "EOD_NOT_READY" },
        )
      }
      return {
        runKey,
        scanDate,
        stocks: selection.stocks,
        rankWarnings: selection.warnings,
        market,
      }
    },
    summarize: (result) => ({
      runKey: result.runKey,
      scanDate: result.scanDate,
      universeCount: result.stocks.length,
      rankWarnings: result.rankWarnings.slice(0, 10),
      freshMarketCount: result.market.freshMarketCount,
      universeRunId: result.market.universeRunId,
      architecture: "supabase-first-eod-v4-dag",
    }),
  })
}

export async function runMarketCloseCollectStep(runId: string, startedAtIso: string, enabled = true) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "MARKET_CLOSE_COLLECT",
      reason: "Market close collection skipped for this invocation.",
    })
    return {
      skipped: true as const,
      status: "skipped" as const,
      sessionDate: vietnamDateKey(startedAtIso),
    }
  }

  return runQeoIndexEodPhase({
    runId,
    phaseKey: "MARKET_CLOSE_COLLECT",
    fn: async () => {
      const supabase = requiredSupabase()
      const supabaseUrl = process.env.SUPABASE_URL
        || process.env.NEXT_PUBLIC_SUPABASE_URL
        || "https://glwhhrmejlonhyorvtzm.supabase.co"
      const secretResult = await supabase.rpc("qeo_get_market_close_sync_secret")
      const syncSecret = typeof secretResult.data === "string" ? secretResult.data.trim() : ""
      if (secretResult.error || !syncSecret) {
        throw Object.assign(
          new Error(`MARKET_CLOSE_COLLECT failed to load dedicated sync secret: ${secretResult.error?.message || "missing secret"}`),
          { code: "MARKET_CLOSE_COLLECT_FAILED" },
        )
      }

      const cleanUrl = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl
      const sessionDate = vietnamDateKey(startedAtIso)
      const canonicalUniverse = await getCanonicalUniverse()
      const expectedUniverseCount = canonicalUniverse.stocks.length
      if (!canonicalUniverse.runId || expectedUniverseCount < 1) {
        throw Object.assign(
          new Error("MARKET_CLOSE_COLLECT ORDERBOOK_VALIDATION_FAILED: canonical universe is unavailable"),
          { code: "MARKET_CLOSE_COLLECT_FAILED" },
        )
      }

      const orderbookResponse = await fetch(`${cleanUrl}/functions/v1/orderbook-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${syncSecret}`,
        },
        body: JSON.stringify({
          action: "eod_final_snapshot",
          source: "qeoindex_eod_pipeline",
          startedAt: startedAtIso,
          sessionDate,
          universeRunId: canonicalUniverse.runId,
        }),
        signal: AbortSignal.timeout(60_000),
      }).catch((error) => ({
        ok: false,
        status: 500,
        json: async () => ({ message: error instanceof Error ? error.message : String(error) }),
      } as unknown as Response))
      const orderbookPayload = await orderbookResponse.json().catch(() => ({})) as Record<string, unknown>
      if (!orderbookResponse.ok || orderbookPayload.ok === false) {
        const errorCode = String(orderbookPayload.message || orderbookPayload.error || `HTTP_${orderbookResponse.status}`)
        throw Object.assign(
          new Error(`MARKET_CLOSE_COLLECT failed: ORDERBOOK_${errorCode}`),
          { code: "MARKET_CLOSE_COLLECT_FAILED", status: orderbookResponse.status },
        )
      }

      const orderbookSessionDate = String(orderbookPayload.session_date || "")
      const orderbookUniverseRunId = String(orderbookPayload.universeRunId || "")
      const orderbookCount = Number(orderbookPayload.count)
      const orderbookUniverseCount = Number(orderbookPayload.universeCount)
      const validOrderbookSnapshot = orderbookSessionDate === sessionDate
        && orderbookUniverseRunId === canonicalUniverse.runId
        && Number.isInteger(orderbookCount)
        && orderbookCount === expectedUniverseCount
        && Number.isInteger(orderbookUniverseCount)
        && orderbookUniverseCount === expectedUniverseCount
      if (!validOrderbookSnapshot) {
        throw Object.assign(
          new Error(
            `MARKET_CLOSE_COLLECT ORDERBOOK_VALIDATION_FAILED: session=${orderbookSessionDate || "missing"}/${sessionDate}`
            + ` run=${orderbookUniverseRunId || "missing"}/${canonicalUniverse.runId}`
            + ` count=${orderbookCount}/${expectedUniverseCount}`
            + ` universeCount=${orderbookUniverseCount}/${expectedUniverseCount}`,
          ),
          { code: "MARKET_CLOSE_COLLECT_FAILED", status: 500 },
        )
      }

      const response = await fetch(`${cleanUrl}/functions/v1/market-insight-eod-sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${syncSecret}`,
        },
        body: JSON.stringify({ startedAt: startedAtIso, trigger: "qeoindex_eod_pipeline" }),
        signal: AbortSignal.timeout(30_000),
      }).catch((error) => ({
        ok: false,
        status: 500,
        json: async () => ({ error: error instanceof Error ? error.message : String(error) }),
      } as unknown as Response))
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || payload.ok === false) {
        const errorCode = String(payload.error || `HTTP_${response.status}`)
        throw Object.assign(
          new Error(`MARKET_CLOSE_COLLECT failed: ${errorCode}`),
          { code: "MARKET_CLOSE_COLLECT_FAILED", status: response.status },
        )
      }
      return {
        ok: true,
        status: "succeeded" as const,
        syncRunId: String(payload.sync_run_id || ""),
        sessionDate: String(payload.session_date || sessionDate),
        qualityStatus: String(payload.quality_status || "healthy"),
        published: payload.published,
        orderbookCount,
        orderbookUniverseCount,
        orderbookUniverseRunId,
      }
    },
    summarize: (result) => ({
      status: result.status,
      sessionDate: result.sessionDate,
      qualityStatus: "qualityStatus" in result ? result.qualityStatus : "unknown",
      syncRunId: "syncRunId" in result ? result.syncRunId : undefined,
      orderbookCount: "orderbookCount" in result ? result.orderbookCount : undefined,
      orderbookUniverseCount: "orderbookUniverseCount" in result ? result.orderbookUniverseCount : undefined,
      orderbookUniverseRunId: "orderbookUniverseRunId" in result ? result.orderbookUniverseRunId : undefined,
    }),
  })
}

export async function runCompleteStep(runId: string, summary: Record<string, unknown>) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "COMPLETE",
    fn: async () => {
      const finishedAt = new Date().toISOString()
      const result = await requiredSupabase().from("system_job_runs").update({
        status: "succeeded",
        finished_at: finishedAt,
        summary: {
          ...summary,
          architecture: "supabase-first-eod-v4-dag",
        },
      }).eq("id", runId)
      if (result.error) throw new Error(`QeoIndex EOD telemetry completion failed: ${result.error.message}`)
      return { ok: true as const, status: "succeeded" as const, finishedAt }
    },
    summarize: (result) => result,
  })
}
