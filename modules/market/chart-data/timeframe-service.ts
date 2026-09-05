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
import { getCanonicalChartOhlcv, type ChartDataServiceDeps } from "./service"
import {
  aggregateChartTimeframe,
  canonicalSourceResolution,
  sourceRangeForResolution,
  splitCanonicalSourceRange,
} from "./timeframes"

const DAY_SECONDS = 86400
const MAX_DERIVED_INTRADAY_SPAN_SECONDS = 186 * DAY_SECONDS
const MAX_DERIVED_DAILY_SPAN_SECONDS = 40 * 366 * DAY_SECONDS

type CanonicalLoader = (request: CanonicalChartOhlcvRequest) => Promise<CanonicalChartOhlcvResult>

export interface ChartTimeframeServiceDeps extends ChartDataServiceDeps {
  canonicalLoader?: CanonicalLoader
}

function normalizePublicRequest(input: ChartOhlcvRequest): ChartOhlcvRequest {
  const ticker = String(input.ticker || "").trim().toUpperCase()
  const resolution = String(input.resolution || "")
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new ChartDataRequestError("Invalid ticker")
  if (!isChartResolution(resolution)) throw new ChartDataRequestError("Unsupported chart resolution")
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from <= 0 || input.to <= input.from) {
    throw new ChartDataRequestError("Invalid chart range")
  }

  const sourceResolution = canonicalSourceResolution(resolution)
  if (resolution !== sourceResolution) {
    const span = input.to - input.from
    const maxSpan = sourceResolution === "1m" ? MAX_DERIVED_INTRADAY_SPAN_SECONDS : MAX_DERIVED_DAILY_SPAN_SECONDS
    if (span > maxSpan) throw new ChartDataRequestError("Derived chart range is too large")
  }

  return { ticker, resolution, from: input.from, to: input.to }
}

function mergeBars(results: CanonicalChartOhlcvResult[]) {
  const byTime = new Map<number, CanonicalOhlcvBar>()
  for (const result of results) {
    for (const bar of result.bars) byTime.set(bar.time, bar)
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

function uniqueErrors(results: CanonicalChartOhlcvResult[]): ChartDataError[] {
  return [...new Map(results.flatMap((result) => result.errors).map((error) => [error.code, error])).values()]
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

export async function getChartOhlcv(
  deps: ChartTimeframeServiceDeps,
  input: ChartOhlcvRequest,
): Promise<ChartOhlcvResult> {
  const request = normalizePublicRequest(input)
  const sourceResolution = canonicalSourceResolution(request.resolution)
  const loadCanonical: CanonicalLoader = deps.canonicalLoader
    ?? ((canonicalRequest) => getCanonicalChartOhlcv(deps, canonicalRequest))

  if (request.resolution === "1m" || request.resolution === "1D") {
    const result = await loadCanonical({ ...request, resolution: sourceResolution })
    return { ...result, resolution: request.resolution }
  }

  const sourceRange = sourceRangeForResolution(request.resolution, request.from, request.to)
  const chunks = splitCanonicalSourceRange(sourceResolution, sourceRange.from, sourceRange.to)
  const results: CanonicalChartOhlcvResult[] = []
  for (const chunk of chunks) {
    results.push(await loadCanonical({
      ticker: request.ticker,
      resolution: sourceResolution,
      from: chunk.from,
      to: chunk.to,
    }))
  }

  const sourceBars = mergeBars(results)
  const aggregated = aggregateChartTimeframe(sourceBars, request.resolution)
  const bars = request.resolution === "3D"
    ? filterThreeDayRange(aggregated, request.from, request.to)
    : aggregated.filter((bar) => bar.time >= sourceRange.from && bar.time <= request.to)
  const gaps = uniqueGaps(results)
  const integrityIssues = uniqueIntegrity(results)
  const errors = uniqueErrors(results)
  const complete = bars.length > 0
    && results.every((result) => result.coverage.complete)
    && gaps.length === 0
    && integrityIssues.length === 0
    && errors.length === 0

  return {
    ...request,
    bars,
    gaps,
    integrityIssues,
    errors,
    coverage: { complete, state: complete ? "COMPLETE" : "PARTIAL" },
  }
}
