import "server-only"

import { getCanonicalUniverse } from "@/modules/market/universe/index"
import { getSupabaseServerClient } from "@/modules/shared/supabase/server"
import {
  bootstrapChartIntradayChunk,
  qeo107BootstrapTarget,
  readChartIntradayCoverageReport,
  type Qeo107BootstrapChunk,
  type Qeo107BootstrapChunkResult,
  type Qeo107BootstrapTarget,
  type Qeo107CoverageRow,
} from "./bootstrap"

const CANONICAL_QEO107_UNIVERSE_SIZE = 200

export interface Qeo107BootstrapStock {
  ticker: string
  rank: number
  exchange: string | null
}

export interface Qeo107BootstrapContext {
  startedAt: string
  universeRunId: string
  universeSourceAsOfDate: string
  selectedCount: number
  stocks: Qeo107BootstrapStock[]
  target: Qeo107BootstrapTarget
}

export interface Qeo107BootstrapWorkflowSummary {
  stoppedEarly: boolean
  stopReason: string | null
  attemptedChunks: number
  succeededChunks: number
  skippedChunks: number
  providerGapChunks: number
  retryableFailureChunks: number
  failedChunks: number
  coverage: {
    tickerCount: number
    hotCoveredTickers: number
    coldCoveredTickers: number
    derivedHourlyCoveredTickers: number
    providerGapTickers: number
    retryableFailureTickers: number
    failedAttemptTickers: number
  }
  rows: Qeo107CoverageRow[]
}

function requireSupabase() {
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role unavailable for QEO-107 chart bootstrap")
  return supabase
}

export async function startChartIntradayBootstrapStep(startedAtIso: string): Promise<Qeo107BootstrapContext> {
  "use step"

  const startedAt = new Date(startedAtIso)
  if (Number.isNaN(startedAt.getTime())) throw new Error("QEO-107 bootstrap requires a valid startedAt timestamp")
  const universe = await getCanonicalUniverse()
  if (universe.selectedCount !== CANONICAL_QEO107_UNIVERSE_SIZE || universe.stocks.length !== CANONICAL_QEO107_UNIVERSE_SIZE) {
    throw new Error(`QEO-107 requires canonical ${CANONICAL_QEO107_UNIVERSE_SIZE} universe, found ${universe.selectedCount}`)
  }
  return {
    startedAt: startedAt.toISOString(),
    universeRunId: universe.runId,
    universeSourceAsOfDate: universe.sourceAsOfDate,
    selectedCount: universe.selectedCount,
    stocks: universe.stocks.map((stock) => ({ ticker: stock.ticker, rank: stock.rank, exchange: stock.exchange })),
    target: qeo107BootstrapTarget(startedAt),
  }
}

export async function runChartIntradayBootstrapTickerStep(input: {
  ticker: string
  chunk: Qeo107BootstrapChunk
  referenceAt: string
}): Promise<Qeo107BootstrapChunkResult> {
  "use step"

  const referenceAt = new Date(input.referenceAt)
  if (Number.isNaN(referenceAt.getTime())) throw new Error("QEO-107 ticker step requires a valid referenceAt timestamp")
  return bootstrapChartIntradayChunk(requireSupabase(), {
    ticker: input.ticker,
    chunk: input.chunk,
    referenceAt,
  })
}

export async function finishChartIntradayBootstrapStep(input: {
  context: Qeo107BootstrapContext
  stoppedEarly: boolean
  stopReason: string | null
  attemptedChunks: number
  succeededChunks: number
  skippedChunks: number
  providerGapChunks: number
  retryableFailureChunks: number
  failedChunks: number
}): Promise<Qeo107BootstrapWorkflowSummary> {
  "use step"

  const rows = await readChartIntradayCoverageReport(requireSupabase(), {
    tickers: input.context.stocks.map((stock) => stock.ticker),
    referenceAt: new Date(input.context.startedAt),
  })
  if (rows.length !== input.context.selectedCount) {
    throw new Error(`QEO-107 coverage report mismatch ${rows.length}/${input.context.selectedCount}`)
  }
  return {
    stoppedEarly: input.stoppedEarly,
    stopReason: input.stopReason,
    attemptedChunks: input.attemptedChunks,
    succeededChunks: input.succeededChunks,
    skippedChunks: input.skippedChunks,
    providerGapChunks: input.providerGapChunks,
    retryableFailureChunks: input.retryableFailureChunks,
    failedChunks: input.failedChunks,
    coverage: {
      tickerCount: rows.length,
      hotCoveredTickers: rows.filter((row) => row.hotRowCount > 0).length,
      coldCoveredTickers: rows.filter((row) => row.coldManifestCount > 0).length,
      derivedHourlyCoveredTickers: rows.filter((row) => row.derivedHourlyRowCount > 0).length,
      providerGapTickers: rows.filter((row) => row.providerGapCount > 0).length,
      retryableFailureTickers: rows.filter((row) => row.retryableFailureCount > 0).length,
      failedAttemptTickers: rows.filter((row) => row.failedAttemptCount > 0).length,
    },
    rows,
  }
}
