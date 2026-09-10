import "server-only"

import { getCanonicalUniverse, getCanonicalUniverseVersion } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  readQeo180MissingHotSessions,
  runQeo180HotContinuityRange,
  type Qeo180HotContinuityPlan,
  type Qeo180MissingHotSession,
} from "./hot-continuity"
import { readChartStorageCapacity, type ChartStorageCapacity } from "./storage-capacity"

export type { Qeo180MissingHotSession } from "./hot-continuity"

const CANONICAL_QEO180_UNIVERSE_SIZE = 200
export const QEO180_CATCHUP_BATCH_SIZE = 10
export const QEO180_MAX_RETRYABLE_ATTEMPTS = 2

export type Qeo180CatchupOutcome = "succeeded" | "skipped" | "provider_gap" | "retryable_failure" | "failed"

export interface Qeo180HotContinuityContext extends Qeo180HotContinuityPlan {
  startedAt: string
  dispatchId: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  tickers: string[]
  initialCapacity: ChartStorageCapacity
}

export interface Qeo180CatchupResult extends Qeo180MissingHotSession {
  outcome: Qeo180CatchupOutcome
  attempts: number
  provider: string | null
  fetchedRows: number
  failureCodes: string[]
  error: string | null
}

export interface Qeo180HotContinuitySummary {
  dispatchId: string
  startedAt: string
  finishedAt: string
  universeRunId: string
  universeSourceAsOfDate: string
  universeChangedDuringRun: boolean
  selectedCount: number
  expectedSessions: string[]
  currentExpectedSession: string
  historicalExpectedSessions: string[]
  initialMissingRanges: number
  attemptedRanges: number
  remainingMissingRanges: number
  status: "complete" | "partial"
  capacityStopped: boolean
  counts: {
    succeeded: number
    skipped: number
    providerGap: number
    retryableFailure: number
    failed: number
  }
  initialCapacityLevel: ChartStorageCapacity["level"]
  finalCapacityLevel: ChartStorageCapacity["level"]
}

function requireSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-180 HOT continuity")
  return supabase
}

function validDispatchId(value: string) {
  const normalized = String(value || "").trim()
  if (!/^qeo180-[a-zA-Z0-9_-]{8,128}$/.test(normalized)) throw new Error("QEO-180 requires a valid dispatchId")
  return normalized
}

export async function startChartIntradayHotContinuityStep(
  startedAtIso: string,
  dispatchIdInput: string,
): Promise<Qeo180HotContinuityContext> {
  "use step"

  const startedAt = new Date(startedAtIso)
  if (!Number.isFinite(startedAt.getTime())) throw new Error("QEO-180 requires a valid startedAt timestamp")
  const dispatchId = validDispatchId(dispatchIdInput)
  const universe = await getCanonicalUniverse()
  if (universe.selectedCount !== CANONICAL_QEO180_UNIVERSE_SIZE || universe.stocks.length !== CANONICAL_QEO180_UNIVERSE_SIZE) {
    throw new Error(`QEO-180 requires canonical ${CANONICAL_QEO180_UNIVERSE_SIZE} universe, found ${universe.selectedCount}`)
  }
  const tickers = universe.stocks.map((stock) => stock.ticker)
  const [plan, initialCapacity] = await Promise.all([
    readQeo180MissingHotSessions(requireSupabase(), { tickers, referenceAt: startedAt }),
    readChartStorageCapacity(requireSupabase()),
  ])
  return {
    ...plan,
    startedAt: startedAt.toISOString(),
    dispatchId,
    universeRunId: universe.runId,
    universeSourceAsOfDate: universe.sourceAsOfDate,
    selectedCount: universe.selectedCount,
    tickers,
    initialCapacity,
  }
}

export async function checkChartIntradayHotContinuityCapacityStep() {
  "use step"
  const capacity = await readChartStorageCapacity(requireSupabase())
  return { allowed: capacity.level !== "HARD_STOP", capacity }
}

export async function runChartIntradayHotContinuityRangeStep(input: {
  range: Qeo180MissingHotSession
  referenceAt: string
  attempt: number
}): Promise<Qeo180CatchupResult> {
  "use step"

  const referenceAt = new Date(input.referenceAt)
  if (!Number.isFinite(referenceAt.getTime())) throw new Error("QEO-180 range step requires a valid referenceAt")
  const result = await runQeo180HotContinuityRange(requireSupabase(), { ...input.range, referenceAt })
  return {
    ...input.range,
    outcome: result.status,
    attempts: input.attempt,
    provider: result.provider,
    fetchedRows: result.fetchedRows,
    failureCodes: result.failureCodes,
    error: result.error,
  }
}

export async function finishChartIntradayHotContinuityStep(input: {
  context: Qeo180HotContinuityContext
  results: Qeo180CatchupResult[]
  capacityStopped: boolean
}): Promise<Qeo180HotContinuitySummary> {
  "use step"

  const [finalPlan, finalCapacity, latestUniverse] = await Promise.all([
    readQeo180MissingHotSessions(requireSupabase(), {
      tickers: input.context.tickers,
      referenceAt: new Date(input.context.startedAt),
    }),
    readChartStorageCapacity(requireSupabase()),
    getCanonicalUniverseVersion(),
  ])
  return {
    dispatchId: input.context.dispatchId,
    startedAt: input.context.startedAt,
    finishedAt: new Date().toISOString(),
    universeRunId: input.context.universeRunId,
    universeSourceAsOfDate: input.context.universeSourceAsOfDate,
    universeChangedDuringRun: latestUniverse.runId !== input.context.universeRunId,
    selectedCount: input.context.selectedCount,
    expectedSessions: input.context.expectedSessions,
    currentExpectedSession: input.context.currentExpectedSession,
    historicalExpectedSessions: input.context.historicalExpectedSessions,
    initialMissingRanges: input.context.missingHotSessions.length,
    attemptedRanges: input.results.length,
    remainingMissingRanges: finalPlan.missingHotSessions.length,
    status: finalPlan.missingHotSessions.length === 0 ? "complete" : "partial",
    capacityStopped: input.capacityStopped,
    counts: {
      succeeded: input.results.filter((result) => result.outcome === "succeeded").length,
      skipped: input.results.filter((result) => result.outcome === "skipped").length,
      providerGap: input.results.filter((result) => result.outcome === "provider_gap").length,
      retryableFailure: input.results.filter((result) => result.outcome === "retryable_failure").length,
      failed: input.results.filter((result) => result.outcome === "failed").length,
    },
    initialCapacityLevel: input.context.initialCapacity.level,
    finalCapacityLevel: finalCapacity.level,
  }
}
