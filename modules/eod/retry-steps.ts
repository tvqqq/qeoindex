import "server-only"

import { runQeoIndexEodPhase } from "../admin/job-phase-telemetry.ts"
import { QEOINDEX_EOD_JOB_KEY } from "../admin/job-phases.ts"
import { getCanonicalUniverse } from "../market/universe/index.ts"
import type { EodTickerAttempt } from "./fault-isolation.ts"
import { loadEodTickerAttempts } from "./ticker-telemetry.ts"
import { getSupabaseServerClient } from "../shared/supabase/server.ts"
import type { WyckoffV2UniverseRow } from "../wyckoff/eod-universe.ts"

interface StoredEodRunRow {
  id: string
  job_key: string
  status: string
  started_at: string
  summary: unknown
}

const SUPPORTED_EXCHANGES = new Set(["HOSE", "HNX", "UPCOM"])

function requiredSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role is not configured")
  return supabase
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredSummaryString(summary: Record<string, unknown>, key: string) {
  const value = String(summary[key] || "").trim()
  if (!value) throw new Error(`EOD retry context is missing ${key}`)
  return value
}

function toRetryUniverseStocks(stocks: Awaited<ReturnType<typeof getCanonicalUniverse>>["stocks"]): WyckoffV2UniverseRow[] {
  return stocks.map((stock) => {
    const exchange = String(stock.exchange || "").trim().toUpperCase()
    if (!SUPPORTED_EXCHANGES.has(exchange)) {
      throw new Error(`EOD retry canonical exchange is invalid for ${stock.ticker}: ${exchange || "missing"}`)
    }
    return {
      ticker: stock.ticker,
      active: true,
      exchange,
      rank: stock.rank,
      sector: String(stock.sector || "").trim(),
    }
  })
}

export async function loadEodRetryContextStep(runId: string) {
  "use step"
  const supabase = requiredSupabase()
  const result = await supabase
    .from("system_job_runs")
    .select("id,job_key,status,started_at,summary")
    .eq("id", runId)
    .single()
  if (result.error || !result.data) {
    throw new Error(`EOD retry run load failed: ${result.error?.message || "run not found"}`)
  }

  const row = result.data as StoredEodRunRow
  if (row.job_key !== QEOINDEX_EOD_JOB_KEY) throw new Error(`Run ${runId} is not a QeoIndex EOD run`)
  if (row.status !== "partial") throw new Error(`Run ${runId} status must be partial before targeted retry; received ${row.status}`)

  const summary = record(row.summary)
  const runKey = requiredSummaryString(summary, "runKey")
  const scanDate = requiredSummaryString(summary, "scanDate")
  const universeRunId = requiredSummaryString(summary, "universeRunId")
  const expectedCount = Number(summary.expectedCount ?? summary.universeCount)
  if (!Number.isInteger(expectedCount) || expectedCount < 1) throw new Error("EOD retry context has invalid expectedCount")

  const canonical = await getCanonicalUniverse()
  if (canonical.runId !== universeRunId) {
    throw new Error(`EOD retry canonical universe changed: ${canonical.runId} != ${universeRunId}`)
  }
  if (canonical.selectedCount !== expectedCount || canonical.stocks.length !== expectedCount) {
    throw new Error(`EOD retry canonical count changed: ${canonical.stocks.length}/${expectedCount}`)
  }
  const canonicalStocks = toRetryUniverseStocks(canonical.stocks)

  const tickerAttempts = await loadEodTickerAttempts(supabase, runId)
  if (!tickerAttempts.length) throw new Error(`EOD retry run ${runId} has no persisted ticker attempts`)

  return {
    runId,
    startedAtIso: row.started_at,
    runKey,
    scanDate,
    universeRunId,
    expectedCount,
    canonicalStocks,
    tickerAttempts,
  }
}

export async function completeRecoveredEodRunStep(input: {
  runId: string
  runKey: string
  scanDate: string
  universeRunId: string
  expectedCount: number
  validationHash: string
  tickerAttempts: readonly EodTickerAttempt[]
  retryTickers: readonly string[]
  summary: Record<string, unknown>
}) {
  "use step"
  return runQeoIndexEodPhase({
    runId: input.runId,
    phaseKey: "COMPLETE",
    fn: async () => {
      const finishedAt = new Date().toISOString()
      const result = await requiredSupabase().from("system_job_runs").update({
        status: "succeeded",
        finished_at: finishedAt,
        summary: {
          ...input.summary,
          architecture: "supabase-first-eod-v4",
          terminalStatus: "succeeded",
          recoveredFromPartial: true,
          runKey: input.runKey,
          scanDate: input.scanDate,
          universeRunId: input.universeRunId,
          expectedCount: input.expectedCount,
          healthyCount: input.expectedCount,
          failedCount: 0,
          retryTickers: [...input.retryTickers],
          validationHash: input.validationHash,
          tickerAttempts: input.tickerAttempts,
        },
        error_code: null,
        error_message: null,
      }).eq("id", input.runId)
      if (result.error) throw new Error(`Recovered EOD completion failed: ${result.error.message}`)
      return { ok: true as const, status: "succeeded" as const, finishedAt }
    },
    summarize: (result) => ({
      status: result.status,
      recoveredFromPartial: true,
      retryTickers: input.retryTickers,
      validationHash: input.validationHash,
    }),
  })
}
