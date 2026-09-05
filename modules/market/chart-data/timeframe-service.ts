import "server-only"

import type {
  CanonicalChartOhlcvRequest,
  CanonicalChartOhlcvResult,
  CanonicalOhlcvBar,
  ChartDataError,
  ChartDataGap,
  ChartDataIntegrityIssue,
  ChartOhlcvRequest,
  ChartOhlcvResult,
} from "./contract"
import { ChartDataRequestError, isChartResolution } from "./contract"
import { createSupabaseColdOhlcvStorage } from "./cold-store"
import {
  derivedHourlyColdCoverageComplete,
  readDerivedHourlyRange,
} from "./derived-hourly-store"
import { chartHotRetentionCutoff, clampChartHistoryRange } from "./history-policy"
import { getCanonicalChartOhlcv, type ChartDataServiceDeps } from "./service"
import {
  aggregateChartTimeframe,
  canonicalSourceResolution,
  sourceRangeForResolution,
  splitCanonicalSourceRange,
} from "./timeframes"

type CanonicalLoader = (request: CanonicalChartOhlcvRequest) => Promise<CanonicalChartOhlcvResult>
type DerivedHourlyLoader = (input: { ticker: string; from: number; to: number }) => Promise<CanonicalOhlcvBar[]>
type DerivedCoverageLoader = (input: { ticker: string; from: number; to: number }) => Promise<boolean>

export interface ChartTimeframeServiceDeps extends ChartDataServiceDeps {
  canonicalLoader?: CanonicalLoader
  derivedHourlyLoader?: DerivedHourlyLoader
  derivedCoverageLoader?: DerivedCoverageLoader
}

const HOURLY_RESOLUTIONS = new Set(["1h", "2h", "4h"])

function normalizePublicRequest(input: ChartOhlcvRequest): ChartOhlcvRequest {
  const ticker = String(input.ticker || "").trim().toUpperCase()
  const resolution = String(input.resolution || "")
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new ChartDataRequestError("Invalid ticker")
  if (!isChartResolution(resolution)) throw new ChartDataRequestError("Unsupported chart resolution")
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from <= 0 || input.to <= input.from) throw new ChartDataRequestError("Invalid chart range")
  const range = clampChartHistoryRange({ resolution, from: input.from, to: input.to })
  return { ticker, resolution, from: range.from, to: range.to }
}

function mergeBars(results: CanonicalChartOhlcvResult[]) {
  const byTime = new Map<number, CanonicalOhlcvBar>()
  for (const result of results) for (const bar of result.bars) byTime.set(bar.time, bar)
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

function mergeHourlyBars(oldBars: CanonicalOhlcvBar[], recentBars: CanonicalOhlcvBar[]) {
  const byTime = new Map<number, CanonicalOhlcvBar>()
  for (const bar of oldBars) byTime.set(bar.time, bar)
  for (const bar of recentBars) byTime.set(bar.time, bar)
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

function uniqueErrors(results: CanonicalChartOhlcvResult[]): ChartDataError[] {
  return [...new Map(results.flatMap((result) => result.errors).map((error) => [error.code, error])).values()]
}
function mergeErrors(...groups: ChartDataError[][]): ChartDataError[] {
  return [...new Map(groups.flat().map((error) => [error.code, error])).values()]
}
function uniqueGaps(results: CanonicalChartOhlcvResult[]): ChartDataGap[] {
  return [...new Map(results.flatMap((result) => result.gaps).map((gap) => [`${gap.fromTime}:${gap.toTime}`, gap])).values()]
}
function uniqueIntegrity(results: CanonicalChartOhlcvResult[]): ChartDataIntegrityIssue[] {
  return [...new Map(results.flatMap((result) => result.integrityIssues).map((issue) => [JSON.stringify(issue), issue])).values()]
}
function filterThreeDayRange(bars: CanonicalOhlcvBar[], from: number, to: number) {
  const before = bars.filter((bar) => bar.time < from).at(-1)
  const inside = bars.filter((bar) => bar.time >= from && bar.time <= to)
  return before ? [before, ...inside] : inside
}

async function loadHourlyFamily(deps: ChartTimeframeServiceDeps, request: ChartOhlcvRequest, loadCanonical: CanonicalLoader): Promise<ChartOhlcvResult> {
  const referenceAt = deps.now ?? new Date()
  const hotCutoff = chartHotRetentionCutoff(referenceAt)
  const sourceRange = sourceRangeForResolution(request.resolution, request.from, request.to)
  const loadDerived: DerivedHourlyLoader = deps.derivedHourlyLoader ?? ((input) => readDerivedHourlyRange(deps.supabase, input.ticker, input.from, input.to))
  const derivedCoverage: DerivedCoverageLoader = deps.derivedCoverageLoader ?? ((input) => derivedHourlyColdCoverageComplete(deps.supabase, input))

  const oldFrom = sourceRange.from
  const oldTo = Math.min(request.to, hotCutoff - 1)
  const oldRequested = oldFrom <= oldTo
  const oldErrors: ChartDataError[] = []
  let oldHourly: CanonicalOhlcvBar[] = []
  let oldProvider: string | null = null
  if (oldRequested) {
    try {
      const coverageComplete = await derivedCoverage({ ticker: request.ticker, from: oldFrom, to: oldTo })
      if (coverageComplete) {
        oldHourly = await loadDerived({ ticker: request.ticker, from: oldFrom, to: oldTo })
        if (oldHourly.length) oldProvider = "DERIVED_1H_CACHE"
      } else {
        const coldStorage = deps.coldStorage ?? createSupabaseColdOhlcvStorage(deps.supabase)
        const cold = await coldStorage.readIntersectingRange({ ticker: request.ticker, from: oldFrom, to: oldTo })
        oldHourly = aggregateChartTimeframe(cold.bars, "1h")
        if (oldHourly.length) oldProvider = "VERIFIED_COLD_1M_RECOVERY"
      }
      if (!oldHourly.length) oldErrors.push({ code: "STORAGE_UNAVAILABLE" })
    } catch {
      oldErrors.push({ code: "STORAGE_UNAVAILABLE" })
    }
  }

  const recentFrom = Math.max(sourceRange.from, hotCutoff)
  const recentResults: CanonicalChartOhlcvResult[] = []
  if (recentFrom <= request.to) {
    for (const chunk of splitCanonicalSourceRange("1m", recentFrom, request.to)) {
      recentResults.push(await loadCanonical({ ticker: request.ticker, resolution: "1m", from: chunk.from, to: chunk.to }))
    }
  }

  const recentHourly = aggregateChartTimeframe(mergeBars(recentResults), "1h")
  const mergedHourly = mergeHourlyBars(oldHourly, recentHourly)
  const aggregated = request.resolution === "1h" ? mergedHourly : aggregateChartTimeframe(mergedHourly, request.resolution)
  const bars = aggregated.filter((bar) => bar.time >= sourceRange.from && bar.time <= request.to)

  const gaps = uniqueGaps(recentResults)
  const integrityIssues = uniqueIntegrity(recentResults)
  const errors = mergeErrors(uniqueErrors(recentResults), oldErrors)
  const complete = bars.length > 0
    && (!oldRequested || oldHourly.length > 0)
    && recentResults.every((result) => result.coverage.complete)
    && gaps.length === 0 && integrityIssues.length === 0 && errors.length === 0

  const sourceMetadata = [...recentResults].reverse().find((result) => result.metadata)?.metadata
  const oldPersistedThrough = oldHourly.at(-1)?.time ?? null
  const recentPersistedThrough = sourceMetadata?.persistedThrough ?? null
  const persistedThrough = oldPersistedThrough == null ? recentPersistedThrough : recentPersistedThrough == null ? oldPersistedThrough : Math.max(oldPersistedThrough, recentPersistedThrough)
  const sessionState = sourceMetadata?.sessionState ?? "CLOSED"

  return {
    ...request,
    bars,
    gaps,
    integrityIssues,
    errors,
    coverage: { complete, state: complete ? "COMPLETE" : "PARTIAL" },
    metadata: {
      priceBasis: "RAW",
      provider: sourceMetadata?.provider ?? oldProvider,
      lastUpdatedAt: sourceMetadata?.lastUpdatedAt ?? referenceAt.toISOString(),
      sessionState,
      currentBarTime: sessionState === "LIVE" ? bars.at(-1)?.time ?? null : null,
      persistedThrough,
    },
  }
}

export async function getChartOhlcv(deps: ChartTimeframeServiceDeps, input: ChartOhlcvRequest): Promise<ChartOhlcvResult> {
  const request = normalizePublicRequest(input)
  const sourceResolution = canonicalSourceResolution(request.resolution)
  const loadCanonical: CanonicalLoader = deps.canonicalLoader ?? ((canonicalRequest) => getCanonicalChartOhlcv(deps, canonicalRequest))

  if (request.resolution === "1m" || request.resolution === "1D") {
    const result = await loadCanonical({ ...request, resolution: sourceResolution })
    return { ...result, resolution: request.resolution }
  }
  if (HOURLY_RESOLUTIONS.has(request.resolution)) return loadHourlyFamily(deps, request, loadCanonical)

  const sourceRange = sourceRangeForResolution(request.resolution, request.from, request.to)
  const chunks = splitCanonicalSourceRange(sourceResolution, sourceRange.from, sourceRange.to)
  const results: CanonicalChartOhlcvResult[] = []
  for (const chunk of chunks) results.push(await loadCanonical({ ticker: request.ticker, resolution: sourceResolution, from: chunk.from, to: chunk.to }))

  const aggregated = aggregateChartTimeframe(mergeBars(results), request.resolution)
  const bars = request.resolution === "3D" ? filterThreeDayRange(aggregated, request.from, request.to) : aggregated.filter((bar) => bar.time >= sourceRange.from && bar.time <= request.to)
  const gaps = uniqueGaps(results)
  const integrityIssues = uniqueIntegrity(results)
  const errors = uniqueErrors(results)
  const complete = bars.length > 0 && results.every((result) => result.coverage.complete) && gaps.length === 0 && integrityIssues.length === 0 && errors.length === 0
  const sourceMetadata = [...results].reverse().find((result) => result.metadata)?.metadata
  const metadata = sourceMetadata ? { ...sourceMetadata, currentBarTime: sourceMetadata.sessionState === "LIVE" ? bars.at(-1)?.time ?? null : null } : undefined
  return { ...request, bars, gaps, integrityIssues, errors, coverage: { complete, state: complete ? "COMPLETE" : "PARTIAL" }, metadata }
}
