import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { QEOINDEX_EOD_JOB_KEY } from "@/lib/admin/job-phases"
import {
  refreshOhlcvHistoryBatch,
  type OhlcvUniverseRefreshResult,
} from "@/lib/ohlcv-history-store"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2CachedTickerHistory } from "@/lib/wyckoff-v2-cache-read"
import { validateWyckoffV2SnapshotSet } from "@/lib/wyckoff-v2-contract"
import { loadWyckoffV2Universe } from "@/lib/wyckoff-v2-universe-source"
import type { WyckoffV2UniverseRow } from "@/lib/wyckoff-v2-universe"
import {
  beginWyckoffV2NotionRun,
  stageWyckoffV2Snapshots,
  validateAndFinalizeWyckoffV2NotionRun,
} from "@/lib/wyckoff-v2-notion-staging"
import { claimReadyWyckoffV2Run, publishIngestingWyckoffV2Run } from "@/lib/wyckoff-notion-ingest"

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function vietnamDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

async function assertFinalEodMarketReady(startedAtIso: string) {
  const supabase = requiredSupabase()
  const expectedSessionDate = vietnamDateKey(startedAtIso)
  const latest = await supabase
    .from("insights_stock_ratings")
    .select("as_of_date")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest.error) throw new Error(`Load EOD rating date failed: ${latest.error.message}`)

  const ratingDate = latest.data?.as_of_date ? String(latest.data.as_of_date) : null
  if (ratingDate !== expectedSessionDate) {
    const error = Object.assign(new Error(`KFSP/TTAI rating date ${ratingDate || "missing"} != EOD session ${expectedSessionDate}`), { code: "EOD_NOT_READY" })
    throw error
  }

  const ratings = await supabase
    .from("insights_stock_ratings")
    .select("ticker")
    .eq("is_published", true)
    .eq("source", "kfsp")
    .eq("is_top100", true)
    .eq("as_of_date", expectedSessionDate)
    .order("top100_rank", { ascending: true, nullsFirst: false })
    .order("ticker", { ascending: true })
  if (ratings.error) throw new Error(`Load EOD Top100 ratings failed: ${ratings.error.message}`)

  const tickers = [...new Set((ratings.data || []).map((row) => String(row.ticker || "").trim().toUpperCase()).filter(Boolean))]
  if (tickers.length !== 100) {
    throw Object.assign(new Error(`Top100 rating universe incomplete: ${tickers.length}/100`), { code: "EOD_NOT_READY" })
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
    throw Object.assign(new Error(`Final EOD market snapshots incomplete: ${fresh.size}/${tickers.length}`), { code: "EOD_NOT_READY" })
  }

  return { expectedSessionDate, ratingDate, ratingTickers: tickers, freshMarketCount: fresh.size }
}

async function buildAllSnapshots(stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string) {
  const supabase = requiredSupabase()
  const snapshots: WyckoffV2Snapshot[] = []
  const providers = new Set<string>()

  for (let offset = 0; offset < stocks.length; offset += 10) {
    const batch = await Promise.all(stocks.slice(offset, offset + 10).map(async (stock) => {
      const history = await loadWyckoffV2CachedTickerHistory(supabase, stock.ticker)
      providers.add(history.daily.provider)
      providers.add(history.hourly.provider)
      return buildWyckoffV2TickerSnapshots({ stock, daily: history.daily, hourly: history.hourly, runKey, scanDate })
    }))
    snapshots.push(...batch.flat())
  }

  if (snapshots.length !== 500) throw new Error(`Expected 500 Wyckoff v2 snapshots; received ${snapshots.length}`)
  const validation = validateWyckoffV2SnapshotSet(runKey, snapshots)
  return { snapshots, validation, providers: [...providers].sort() }
}

export async function startQeoIndexEodRunStep(startedAtIso: string) {
  "use step"
  const supabase = requiredSupabase()
  const result = await supabase
    .from("system_job_runs")
    .insert({
      job_key: QEOINDEX_EOD_JOB_KEY,
      provider: "supabase_pg_cron",
      trigger: "workflow",
      status: "running",
      started_at: startedAtIso,
    })
    .select("id")
    .single()
  if (result.error || !result.data?.id) throw new Error(`QeoIndex EOD telemetry start failed: ${result.error?.message || "missing run id"}`)
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
      const runKey = `WYCKOFF-${scanDate}-EOD-v2`
      const notion = await beginWyckoffV2NotionRun({
        runKey,
        scanDate,
        startedAt: startedAtIso,
        providerSummary: "QeoIndex EOD v2 preflight; persistent OHLCV refresh pending.",
      })
      return {
        runKey,
        scanDate,
        stocks: selection.stocks,
        rankWarnings: selection.warnings,
        notionAction: notion.action,
        notionStatus: notion.status,
        notionSupabaseRunId: "supabaseRunId" in notion ? notion.supabaseRunId : "",
        market,
      }
    },
    summarize: (result) => ({
      runKey: result.runKey,
      scanDate: result.scanDate,
      universeCount: result.stocks.length,
      rankWarnings: result.rankWarnings.slice(0, 10),
      notionAction: result.notionAction,
      freshMarketCount: result.market.freshMarketCount,
    }),
  })
}

export async function runMarketCloseCollectStep(runId: string, startedAtIso: string, enabled = true) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "MARKET_CLOSE_COLLECT", reason: "Market close collection skipped for this invocation." })
    return { skipped: true as const, status: "skipped" as const, sessionDate: vietnamDateKey(startedAtIso) }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "MARKET_CLOSE_COLLECT",
    fn: async () => {
      const supabase = requiredSupabase()
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://glwhhrmejlonhyorvtzm.supabase.co"
      const secretResult = await supabase.rpc("qeo_get_market_close_sync_secret")
      const syncSecret = typeof secretResult.data === "string" ? secretResult.data.trim() : ""
      if (secretResult.error || !syncSecret) {
        throw Object.assign(
          new Error(`MARKET_CLOSE_COLLECT failed to load dedicated sync secret: ${secretResult.error?.message || "missing secret"}`),
          { code: "MARKET_CLOSE_COLLECT_FAILED" },
        )
      }
      const cleanUrl = supabaseUrl.endsWith("/") ? supabaseUrl.slice(0, -1) : supabaseUrl
      const endpoint = `${cleanUrl}/functions/v1/market-insight-eod-sync`
      const sessionDate = vietnamDateKey(startedAtIso)

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${syncSecret}`,
        },
        body: JSON.stringify({
          startedAt: startedAtIso,
          trigger: "qeoindex_eod_pipeline",
        }),
        signal: AbortSignal.timeout(30_000),
      }).catch((err) => ({ ok: false, status: 500, json: async () => ({ error: err instanceof Error ? err.message : String(err) }) } as unknown as Response))

      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok || payload.ok === false) {
        const errCode = String(payload.error || `HTTP_${response.status}`)
        throw Object.assign(
          new Error(`MARKET_CLOSE_COLLECT failed: ${errCode}`),
          { code: "MARKET_CLOSE_COLLECT_FAILED" },
        )
      }

      return {
        ok: true,
        status: "succeeded" as const,
        syncRunId: String(payload.sync_run_id || ""),
        sessionDate: String(payload.session_date || sessionDate),
        qualityStatus: String(payload.quality_status || "healthy"),
        published: payload.published,
      }
    },
    summarize: (result) => ({
      status: result.status,
      sessionDate: result.sessionDate,
      qualityStatus: "qualityStatus" in result ? result.qualityStatus : "degraded",
      error: "error" in result ? result.error : undefined,
    }),
  })
}

function mergeHistoryRefreshProgress(
  previous: OhlcvUniverseRefreshResult,
  current: OhlcvUniverseRefreshResult,
): OhlcvUniverseRefreshResult {
  return {
    requestedTickers: previous.requestedTickers + current.requestedTickers,
    completedTickers: previous.completedTickers + current.completedTickers,
    failedTickers: previous.failedTickers + current.failedTickers,
    dailyFetchedBars: previous.dailyFetchedBars + current.dailyFetchedBars,
    hourlyFetchedBars: previous.hourlyFetchedBars + current.hourlyFetchedBars,
    backfillOperations: previous.backfillOperations + current.backfillOperations,
    deltaOperations: previous.deltaOperations + current.deltaOperations,
    limitedCoverage: [...previous.limitedCoverage, ...current.limitedCoverage],
    errors: [...previous.errors, ...current.errors],
  }
}

export async function runHistoryRefreshBatchStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  startedAtIso: string,
  progress: OhlcvUniverseRefreshResult,
  enabled = true,
) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "HISTORY_REFRESH", reason: "Existing Notion run does not require history refresh." })
    return progress
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "HISTORY_REFRESH",
    fn: async () => {
      if (stocks.length < 1 || stocks.length > 10) {
        throw Object.assign(new Error(`HISTORY_REFRESH batch must contain 1-10 tickers; received ${stocks.length}`), { code: "HISTORY_REFRESH_FAILED" })
      }
      const result = await refreshOhlcvHistoryBatch(requiredSupabase(), stocks.map((stock) => stock.ticker), new Date(startedAtIso))
      if (result.failedTickers > 0) {
        throw Object.assign(new Error(`HISTORY_REFRESH failed for ${result.failedTickers} ticker(s): ${result.errors.slice(0, 5).map((item) => `${item.ticker}: ${item.error}`).join(" | ")}`), { code: "HISTORY_REFRESH_FAILED" })
      }
      if (result.completedTickers !== result.requestedTickers) {
        throw Object.assign(new Error(`HISTORY_REFRESH batch completed ${result.completedTickers}/${result.requestedTickers} tickers`), { code: "HISTORY_REFRESH_FAILED" })
      }
      return mergeHistoryRefreshProgress(progress, result)
    },
    summarize: (result) => ({
      requestedTickers: result.requestedTickers,
      completedTickers: result.completedTickers,
      dailyFetchedBars: result.dailyFetchedBars,
      hourlyFetchedBars: result.hourlyFetchedBars,
      backfillOperations: result.backfillOperations,
      deltaOperations: result.deltaOperations,
      limitedCoverageCount: result.limitedCoverage.length,
    }),
  })
}

export async function runWyckoffBuildStep(runId: string, stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string, enabled = true) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "WYCKOFF_BUILD", reason: "Existing Ready/Ingested Notion run; build skipped." })
    return { skipped: true as const, total: 500, complete: 0, incomplete: 0, providers: [] as string[] }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "WYCKOFF_BUILD",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      return { total: built.validation.total, complete: built.validation.complete, incomplete: built.validation.incomplete, providers: built.providers }
    },
    summarize: (result) => result,
  })
}

export async function runNotionStagingStep(runId: string, stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string, enabled = true) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "NOTION_STAGING", reason: "Existing Ready/Ingested Notion run; staging skipped." })
    return { skipped: true as const, created: 0, updated: 0, skippedRows: 500, providers: [] as string[] }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_STAGING",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      const staged = await stageWyckoffV2Snapshots({ runKey, snapshots: built.snapshots })
      return { created: staged.created, updated: staged.updated, skippedRows: staged.skipped, total: staged.total, providers: built.providers }
    },
    summarize: (result) => result,
  })
}

export async function runNotionValidateStep(runId: string, runKey: string, scanDate: string, startedAtIso: string, providerSummary: string, enabled = true) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "NOTION_VALIDATE", reason: "Existing Ready/Ingested Notion run; validation finalize skipped." })
    return { skipped: true as const, status: "Ready" as const, validationHash: "", total: 500, complete: 0, incomplete: 0 }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_VALIDATE",
    fn: () => validateAndFinalizeWyckoffV2NotionRun({
      runKey,
      scanDate,
      startedAt: startedAtIso,
      completedAt: new Date().toISOString(),
      providerSummary,
    }),
    summarize: (result) => ({ status: result.status, total: result.total, complete: result.complete, incomplete: result.incomplete, validationHash: result.validationHash }),
  })
}

export async function runIngestStep(runId: string, runKey: string, enabled = true, resumeSupabaseRunId = "") {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "INGEST", reason: "Run already Ingested; no new claim." })
    return { ok: true as const, status: "idle" as const, runKey, supabaseRunId: "", complete: 0, incomplete: 0, validationHash: "" }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "INGEST",
    fn: async () => {
      if (resumeSupabaseRunId) {
        return {
          ok: true as const,
          status: "resumed" as const,
          runKey,
          supabaseRunId: resumeSupabaseRunId,
          complete: 0,
          incomplete: 0,
          validationHash: "",
        }
      }
      const result = await claimReadyWyckoffV2Run(runKey)
      if (result.status !== "claimed") throw new Error(`INGEST could not claim ${runKey}: ${result.message || result.status}`)
      return result
    },
    summarize: (result) => ({ status: result.status, runKey: result.runKey, complete: result.complete, incomplete: result.incomplete, validationHash: result.validationHash }),
  })
}

export async function runSupabasePublishStep(runId: string, runKey: string, supabaseRunId: string, enabled = true) {
  "use step"
  if (!enabled || !supabaseRunId) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "SUPABASE_PUBLISH", reason: "No active v2 ingest claim to publish." })
    return { ok: true as const, status: "skipped" as const, runKey }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_PUBLISH",
    fn: () => publishIngestingWyckoffV2Run(runKey, supabaseRunId),
    summarize: (result) => result as unknown as Record<string, unknown>,
  })
}

export async function runDeterministicCouncilStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "AI_COUNCIL_DETERMINISTIC", reason: "No new Supabase publish in this pipeline invocation." })
    return { ok: false as const, status: "skipped" as const, reason: "PIPELINE_SKIPPED" as const }
  }
  const operationDate = ratingDate ? new Date(`${ratingDate}T08:15:00.000Z`) : new Date()
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_DETERMINISTIC",
    fn: () => runAiCouncilDailyOperation(requiredSupabase(), operationDate, ratingDate),
    summarize: (result) => ({ ok: result.ok, status: result.status, ratingDate: result.ratingDate, reason: "reason" in result ? result.reason : undefined }),
  })
}

export async function runLlmDebateStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "AI_COUNCIL_LLM", reason: "Deterministic Council did not complete; LLM debate skipped." })
    return { ok: false as const, status: "skipped" as const, reason: "DETERMINISTIC_NOT_READY" as const }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_LLM",
    fn: () => runAiCouncilDebateOperation(requiredSupabase(), ratingDate),
    summarize: (result) => ({ ok: result.ok, status: result.status, ratingDate: result.ratingDate, reason: "reason" in result ? result.reason : undefined }),
  })
}

export async function runCompleteStep(runId: string, summary: Record<string, unknown>, skipped = false) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "COMPLETE",
    fn: async () => {
      const supabase = requiredSupabase()
      const finishedAt = new Date().toISOString()
      const result = await supabase
        .from("system_job_runs")
        .update({ status: skipped ? "skipped" : "succeeded", finished_at: finishedAt, summary })
        .eq("id", runId)
      if (result.error) throw new Error(`QeoIndex EOD telemetry completion failed: ${result.error.message}`)
      return { ok: true as const, status: skipped ? "skipped" as const : "succeeded" as const, finishedAt }
    },
    summarize: (result) => result,
  })
}

export async function failQeoIndexEodRunStep(runId: string, errorMessage: string) {
  "use step"
  const supabase = requiredSupabase()
  await markQeoIndexEodPhaseSkipped({ runId, phaseKey: "COMPLETE", reason: "Pipeline stopped because an earlier phase failed." })
  const result = await supabase
    .from("system_job_runs")
    .update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "QEOINDEX_EOD_FAILED",
      error_message: errorMessage.slice(0, 1000),
    })
    .eq("id", runId)
  if (result.error) throw new Error(`QeoIndex EOD failure telemetry update failed: ${result.error.message}`)
  return { ok: true as const }
}
