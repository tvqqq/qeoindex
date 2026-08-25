import type { SupabaseClient } from "@supabase/supabase-js"

import {
  refreshOhlcvHistoryUniverse,
  type OhlcvUniverseRefreshResult,
} from "./ohlcv-history-store.ts"

export type { OhlcvUniverseRefreshResult } from "./ohlcv-history-store.ts"

export interface EodHistoryRefreshSummary {
  ok: true
  requestedTickers: number
  completedTickers: number
  failedTickers: number
  dailyFetchedBars: number
  hourlyFetchedBars: number
  backfillOperations: number
  deltaOperations: number
  limitedCoverageCount: number
  limitedCoverage: OhlcvUniverseRefreshResult["limitedCoverage"]
}

export class EodHistoryRefreshError extends Error {
  readonly code = "EOD_HISTORY_REFRESH_FAILED"
  readonly result: OhlcvUniverseRefreshResult

  constructor(result: OhlcvUniverseRefreshResult) {
    super(`EOD_HISTORY_REFRESH_FAILED: ${result.completedTickers}/${result.requestedTickers} tickers refreshed`)
    this.name = "EodHistoryRefreshError"
    this.result = result
  }
}

export function buildEodHistoryRefreshSummary(result: OhlcvUniverseRefreshResult): EodHistoryRefreshSummary {
  if (
    result.errors.length > 0
    || result.failedTickers > 0
    || result.completedTickers !== result.requestedTickers
  ) {
    throw new EodHistoryRefreshError(result)
  }

  return {
    ok: true,
    requestedTickers: result.requestedTickers,
    completedTickers: result.completedTickers,
    failedTickers: result.failedTickers,
    dailyFetchedBars: result.dailyFetchedBars,
    hourlyFetchedBars: result.hourlyFetchedBars,
    backfillOperations: result.backfillOperations,
    deltaOperations: result.deltaOperations,
    limitedCoverageCount: result.limitedCoverage.length,
    limitedCoverage: result.limitedCoverage,
  }
}

export async function runEodHistoryRefresh(
  supabase: SupabaseClient,
  input: { tickers: string[]; now?: Date },
): Promise<EodHistoryRefreshSummary> {
  const result = await refreshOhlcvHistoryUniverse(supabase, input.tickers, input.now ?? new Date())
  return buildEodHistoryRefreshSummary(result)
}
