import "server-only"

import { runAiCouncilDailyOperation, runAiCouncilDebateOperation } from "@/lib/ai-council-operations"
import { markQeoIndexEodPhaseSkipped, runQeoIndexEodPhase } from "@/lib/admin/job-phase-telemetry"
import { QEOINDEX_EOD_JOB_KEY } from "@/lib/admin/job-phases"
import {
  archiveCanonicalUniverseBatchToNotion,
  archiveEodRunToNotion,
  archiveEodTickerBatchToNotion,
  runEodDriveArchive,
  runEodRetentionCleanup,
  type EodArchiveCheckpoint,
} from "@/lib/qeoindex-eod-archive"
import { getCanonicalUniverse } from "@/lib/market-universe"
import {
  refreshOhlcvHistoryBatch,
  type OhlcvUniverseRefreshResult,
} from "@/lib/ohlcv-history-store"
import { getSupabaseServerClient } from "@/lib/supabase/server"
import { buildWyckoffV2TickerSnapshots, type WyckoffV2Snapshot } from "@/lib/wyckoff-v2-builder"
import { loadWyckoffV2CachedTickerHistory } from "@/lib/wyckoff-v2-cache-read"
import { computeWyckoffV2ValidationHash, validateWyckoffV2SnapshotSet } from "@/lib/wyckoff-v2-contract"
import { loadWyckoffV2Universe } from "@/lib/wyckoff-v2-universe-source"
import type { WyckoffV2UniverseRow } from "@/lib/wyckoff-v2-universe"
import { publishWyckoffV2SnapshotsDirect } from "@/lib/wyckoff-supabase-publish"

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

async function buildAllSnapshots(stocks: WyckoffV2UniverseRow[], runKey: string, scanDate: string) {
  const supabase = requiredSupabase()
  const snapshots: WyckoffV2Snapshot[] = []
  const providers = new Set<string>()

  for (let offset = 0; offset < stocks.length; offset += 10) {
    const batch = await Promise.all(stocks.slice(offset, offset + 10).map(async (stock) => {
      const history = await loadWyckoffV2CachedTickerHistory(supabase, stock.ticker)
      providers.add(history.daily.provider)
      providers.add(history.hourly.provider)
      return buildWyckoffV2TickerSnapshots({
        stock,
        daily: history.daily,
        hourly: history.hourly,
        runKey,
        scanDate,
      })
    }))
    snapshots.push(...batch.flat())
  }

  const expectedSnapshots = stocks.length * 5
  if (snapshots.length !== expectedSnapshots) {
    throw new Error(`Expected ${expectedSnapshots} Wyckoff snapshots; received ${snapshots.length}`)
  }
  const validation = validateWyckoffV2SnapshotSet(runKey, snapshots)
  const validationHash = computeWyckoffV2ValidationHash(snapshots)
  return {
    snapshots,
    validation,
    validationHash,
    providers: [...providers].sort(),
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
      const runKey = `WYCKOFF-${scanDate}-EOD-v3`
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
      architecture: "supabase-first-eod-v3",
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
      }
    },
    summarize: (result) => ({
      status: result.status,
      sessionDate: result.sessionDate,
      qualityStatus: "qualityStatus" in result ? result.qualityStatus : "unknown",
      syncRunId: "syncRunId" in result ? result.syncRunId : undefined,
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
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "HISTORY_REFRESH",
    fn: async () => {
      if (stocks.length < 1 || stocks.length > 10) {
        throw Object.assign(
          new Error(`HISTORY_REFRESH batch must contain 1-10 tickers; received ${stocks.length}`),
          { code: "HISTORY_REFRESH_FAILED" },
        )
      }
      const result = await refreshOhlcvHistoryBatch(
        requiredSupabase(),
        stocks.map((stock) => stock.ticker),
        new Date(startedAtIso),
      )
      if (result.failedTickers > 0) {
        throw Object.assign(
          new Error(
            `HISTORY_REFRESH failed for ${result.failedTickers} ticker(s): `
            + result.errors.slice(0, 5).map((item) => `${item.ticker}: ${item.error}`).join(" | "),
          ),
          { code: "HISTORY_REFRESH_FAILED" },
        )
      }
      if (result.completedTickers !== result.requestedTickers) {
        throw Object.assign(
          new Error(`HISTORY_REFRESH batch completed ${result.completedTickers}/${result.requestedTickers} tickers`),
          { code: "HISTORY_REFRESH_FAILED" },
        )
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

export async function runWyckoffBuildStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "WYCKOFF_BUILD",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      return {
        total: built.validation.total,
        complete: built.validation.complete,
        incomplete: built.validation.incomplete,
        validationHash: built.validationHash,
        providers: built.providers,
      }
    },
    summarize: (result) => result,
  })
}

export async function runSupabaseValidateStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_VALIDATE",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      const canonical = await getCanonicalUniverse()
      const builtTickers = [...new Set(built.snapshots.map((snapshot) => snapshot.ticker))].sort()
      const canonicalTickers = canonical.stocks.map((stock) => stock.ticker).sort()
      const missing = canonicalTickers.filter((ticker) => !builtTickers.includes(ticker))
      const unexpected = builtTickers.filter((ticker) => !canonicalTickers.includes(ticker))
      if (
        builtTickers.length !== canonical.selectedCount
        || missing.length > 0
        || unexpected.length > 0
      ) {
        throw Object.assign(
          new Error(
            `SUPABASE_VALIDATE canonical mismatch ${builtTickers.length}/${canonical.selectedCount}`
            + `${missing.length ? `; missing=${missing.slice(0, 20).join(",")}` : ""}`
            + `${unexpected.length ? `; unexpected=${unexpected.slice(0, 20).join(",")}` : ""}`,
          ),
          { code: "SUPABASE_VALIDATE_FAILED" },
        )
      }
      return {
        ok: true as const,
        validationHash: built.validationHash,
        universeRunId: canonical.runId,
        tickerCount: builtTickers.length,
        snapshotCount: built.validation.total,
        complete: built.validation.complete,
        incomplete: built.validation.incomplete,
      }
    },
    summarize: (result) => result,
  })
}

export async function runSupabasePublishStep(
  runId: string,
  stocks: WyckoffV2UniverseRow[],
  runKey: string,
  scanDate: string,
  expectedValidationHash: string,
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "SUPABASE_PUBLISH",
    fn: async () => {
      const built = await buildAllSnapshots(stocks, runKey, scanDate)
      if (built.validationHash !== expectedValidationHash) {
        throw Object.assign(
          new Error(`SUPABASE_PUBLISH validation hash changed: ${built.validationHash} != ${expectedValidationHash}`),
          { code: "SUPABASE_PUBLISH_FAILED" },
        )
      }
      return publishWyckoffV2SnapshotsDirect(requiredSupabase(), {
        snapshots: built.snapshots,
        runKey,
        scanDate,
        runId,
      })
    },
    summarize: (result) => ({
      status: result.status,
      runKey: result.runKey,
      universeRunId: result.universeRunId,
      tickerCount: result.tickerCount,
      snapshotCount: result.snapshotCount,
      chartSeriesCount: result.chartSeriesCount,
      validationHash: result.validationHash,
    }),
  })
}

export async function runDeterministicCouncilStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "AI_COUNCIL_DETERMINISTIC",
      reason: "Supabase Wyckoff publish did not complete.",
    })
    return { ok: false as const, status: "skipped" as const, reason: "SUPABASE_NOT_PUBLISHED" as const }
  }
  const operationDate = ratingDate ? new Date(`${ratingDate}T08:15:00.000Z`) : new Date()
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_DETERMINISTIC",
    fn: () => runAiCouncilDailyOperation(requiredSupabase(), operationDate, ratingDate),
    summarize: (result) => ({
      ok: result.ok,
      status: result.status,
      ratingDate: result.ratingDate,
      reason: "reason" in result ? result.reason : undefined,
      stockCount: "stockCount" in result ? result.stockCount : undefined,
    }),
  })
}

export async function runLlmDebateStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "AI_COUNCIL_LLM",
      reason: "Deterministic Council did not complete.",
    })
    return { ok: false as const, status: "skipped" as const, reason: "DETERMINISTIC_NOT_READY" as const }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "AI_COUNCIL_LLM",
    fn: () => runAiCouncilDebateOperation(requiredSupabase(), ratingDate),
    summarize: (result) => ({
      ok: result.ok,
      status: result.status,
      ratingDate: result.ratingDate,
      reason: "reason" in result ? result.reason : undefined,
      selected: "selected" in result ? result.selected : undefined,
      completed: "completed" in result ? result.completed : undefined,
      totalTokens: "totalTokens" in result ? result.totalTokens : undefined,
    }),
  })
}

export async function runMarketSynthesisStep(runId: string, enabled = true, ratingDate?: string) {
  "use step"
  if (!enabled || !ratingDate) {
    await markQeoIndexEodPhaseSkipped({
      runId,
      phaseKey: "MARKET_SYNTHESIS",
      reason: "Council or trading date is not ready for market synthesis.",
    })
    return { ok: false as const, status: "skipped" as const, requestId: null, ratingDate: ratingDate || null }
  }
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "MARKET_SYNTHESIS",
    fn: async () => {
      const result = await requiredSupabase().rpc("dispatch_market_ai_conclusion", {
        p_mode: "session",
        p_session_date: ratingDate,
      })
      if (result.error) {
        throw Object.assign(
          new Error(`MARKET_SYNTHESIS dispatch failed: ${result.error.message}`),
          { code: "MARKET_SYNTHESIS_FAILED" },
        )
      }
      return {
        ok: true as const,
        status: "queued" as const,
        requestId: result.data == null ? null : Number(result.data),
        ratingDate,
      }
    },
    summarize: (result) => result,
  })
}

function combinedArchiveStatus(
  universeArchive: { status: string },
  eodArchive: EodArchiveCheckpoint,
): EodArchiveCheckpoint["status"] {
  const statuses = [universeArchive.status, eodArchive.status]
  if (statuses.every((status) => status === "archived")) return "archived"
  if (statuses.some((status) => status === "error")) return "error"
  if (statuses.some((status) => status === "partial")) return "partial"
  if (statuses.some((status) => status === "blocked")) return "blocked"
  return "skipped"
}

export async function runNotionArchiveStep(
  runId: string,
  input: {
    tradingDate: string
    universeRunId: string
    validationHash: string
  },
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "NOTION_ARCHIVE",
    fn: async (): Promise<EodArchiveCheckpoint & { universeArchiveStatus?: string }> => {
      try {
        const canonical = await getCanonicalUniverse()
        if (canonical.runId !== input.universeRunId) {
          return {
            status: "error",
            archived: 0,
            requested: canonical.selectedCount,
            detail: `Canonical universe changed during EOD: ${canonical.runId} != ${input.universeRunId}`,
          }
        }
        const universeArchive = await archiveCanonicalUniverseBatchToNotion({
          universeRunId: canonical.runId,
          sourceDate: canonical.sourceAsOfDate,
          minMarketCapBillion: canonical.filters.minMarketCapBillion,
          minAverageVolume50d: canonical.filters.minAverageVolume50d,
          stocks: canonical.stocks,
        })
        const eodArchive = await archiveEodTickerBatchToNotion(requiredSupabase(), {
          tradingDate: input.tradingDate,
          universeRunId: input.universeRunId,
          validationHash: input.validationHash,
          stocks: canonical.stocks,
        })
        return {
          ...eodArchive,
          status: combinedArchiveStatus(universeArchive, eodArchive),
          universeArchiveStatus: universeArchive.status,
          detail: [
            "detail" in universeArchive ? universeArchive.detail : undefined,
            "errors" in universeArchive && Array.isArray(universeArchive.errors)
              ? universeArchive.errors.slice(0, 5).join(" | ")
              : undefined,
            eodArchive.detail,
          ].filter(Boolean).join(" | ") || undefined,
        }
      } catch (error) {
        return {
          status: "error",
          archived: 0,
          detail: error instanceof Error ? error.message : String(error),
        }
      }
    },
    summarize: (result) => result,
  })
}

export async function runDriveArchiveStep(
  runId: string,
  input: { tradingDate: string; universeRunId: string; validationHash: string },
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "DRIVE_ARCHIVE",
    fn: async () => {
      try {
        const canonical = await getCanonicalUniverse()
        if (canonical.runId !== input.universeRunId) {
          return {
            status: "error" as const,
            detail: `Canonical universe changed before Drive archive: ${canonical.runId} != ${input.universeRunId}`,
          }
        }
        return runEodDriveArchive(requiredSupabase(), {
          tradingDate: input.tradingDate,
          universeRunId: input.universeRunId,
          validationHash: input.validationHash,
          stocks: canonical.stocks,
        })
      } catch (error) {
        return {
          status: "error" as const,
          detail: error instanceof Error ? error.message : String(error),
          manifestUrl: null,
        }
      }
    },
    summarize: (result) => result,
  })
}

export async function runRetentionCleanupStep(
  runId: string,
  input: {
    startedAtIso: string
    tradingDate: string
    universeRunId: string
    universeCount: number
    expectedSnapshots: number
    completedSnapshots: number
    validationHash: string
    marketSynthesisStatus: string
    notionArchive: EodArchiveCheckpoint
    driveArchive: EodArchiveCheckpoint
  },
) {
  "use step"
  return runQeoIndexEodPhase({
    runId,
    phaseKey: "RETENTION_CLEANUP",
    fn: async () => {
      const retention = await runEodRetentionCleanup(requiredSupabase(), {
        tradingDate: input.tradingDate,
        notionArchive: input.notionArchive,
        driveArchive: input.driveArchive,
      })

      const supabase = requiredSupabase()
      const canonical = await getCanonicalUniverse()
      const tickers = canonical.stocks.map((stock) => stock.ticker)
      const deterministic = await supabase
        .from("ai_council_runs")
        .select("id", { count: "exact", head: true })
        .eq("as_of_date", input.tradingDate)
        .in("ticker", tickers)
      const llm = await supabase
        .from("ai_council_llm_debates")
        .select("status")
        .eq("as_of_date", input.tradingDate)
        .in("ticker", tickers)

      const llmRows = llm.error ? [] : (llm.data || [])
      const llmCompleted = llmRows.filter((row) => ["completed", "succeeded"].includes(String(row.status))).length
      const completedAt = new Date().toISOString()
      const partial = input.notionArchive.status !== "archived"
        || input.driveArchive.status !== "archived"
        || retention.status !== "archived"
        || input.marketSynthesisStatus === "failed"
        || Boolean(deterministic.error)
        || Boolean(llm.error)

      let runArchive: { status: string; detail?: string } = { status: "skipped" }
      try {
        runArchive = await archiveEodRunToNotion({
          tradingDate: input.tradingDate,
          eodRunId: runId,
          status: partial ? "Partial" : "Succeeded",
          universeRunId: input.universeRunId,
          universeCount: input.universeCount,
          expectedSnapshots: input.expectedSnapshots,
          completedSnapshots: input.completedSnapshots,
          deterministicExpected: input.universeCount,
          deterministicCompleted: deterministic.error ? 0 : Number(deterministic.count || 0),
          llmCandidates: llmRows.length,
          llmCompleted,
          validationHash: input.validationHash,
          startedAt: input.startedAtIso,
          completedAt,
          notionArchive: input.notionArchive,
          driveArchive: input.driveArchive,
          retention,
          errorCode: partial ? "ARCHIVE_OR_SYNTHESIS_PARTIAL" : "",
          errorSummary: [
            input.notionArchive.detail,
            input.driveArchive.detail,
            retention.detail,
            deterministic.error?.message,
            llm.error?.message,
          ].filter(Boolean).join(" | ").slice(0, 1800),
        })
      } catch (error) {
        runArchive = {
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        }
      }

      return {
        ...retention,
        notionRunArchive: runArchive.status,
        notionRunArchiveDetail: runArchive.detail,
        deterministicCompleted: deterministic.error ? 0 : Number(deterministic.count || 0),
        llmCandidates: llmRows.length,
        llmCompleted,
      }
    },
    summarize: (result) => result,
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
          architecture: "supabase-first-eod-v3",
        },
      }).eq("id", runId)
      if (result.error) throw new Error(`QeoIndex EOD telemetry completion failed: ${result.error.message}`)
      return { ok: true as const, status: "succeeded" as const, finishedAt }
    },
    summarize: (result) => result,
  })
}
