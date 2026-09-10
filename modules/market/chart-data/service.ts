import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  hasVietnamSecuritiesTradingCalendarCoverage,
  isVietnamSecuritiesTradingDateKey,
  vietnamDateKey,
} from "@/modules/market/calendar"
import { getMarketSessionStatus } from "@/modules/market/realtime/session-countdown"
import { createSupabaseColdOhlcvStorage, type ColdOhlcvStorage } from "./cold-store"
import type {
  CanonicalChartOhlcvRequest,
  CanonicalChartOhlcvResult,
  CanonicalOhlcvBar,
  ChartDataError,
  ChartDataGap,
  SourceTaggedBar,
} from "./contract"
import { ChartDataRequestError, ChartDataUnavailableError } from "./contract"
import { isCanonicalDailyHotRowUsable } from "./daily-authority"
import {
  abandonChartIntradayRange,
  canonicalProviderRangeContentId,
  ChartClosedRangeCoordinationUnavailableError,
  claimChartIntradayRange,
  completeChartIntradayRange,
  readHotIntradayRange,
  readProviderRequestCoverage,
  upsertHotIntradayBars,
} from "./hot-store"
import { activeMinuteStart, partitionLiveMinuteBars } from "./live-session"
import { detectTradingSessionGaps, normalizeCanonicalBars } from "./normalize"
import {
  createPrimaryChartOhlcvProvider,
  normalizeChartProviderResult,
  type ChartOhlcvProvider,
} from "./provider"
import {
  CHART_PROVIDER_SOURCE_KEY,
  runClosedRangeIngestion,
  type ClosedRangeIngestionResult,
} from "./provider-ingestion"
import {
  mergeProviderRanges,
  missingTradingProviderRanges,
  uncoveredProviderRanges,
  type ProviderCoverageRange,
} from "./provider-coverage"

const DAY_SECONDS = 86400
const MAX_INTRADAY_SPAN_SECONDS = 31 * DAY_SECONDS
const MAX_DAILY_SPAN_SECONDS = 100 * 366 * DAY_SECONDS
const DAILY_READ_PAGE_SIZE = 500
const LIVE_TAIL_SECONDS = 5 * 60

export interface ChartDataServiceDeps {
  supabase: SupabaseClient
  coldStorage?: ColdOhlcvStorage
  provider?: ChartOhlcvProvider
  now?: Date
}

interface ClosedProviderValue {
  provider: string
  bars: CanonicalOhlcvBar[]
  persisted: boolean
  changed: boolean
}

export interface ClosedIntradayRevalidationResult {
  status: "completed" | "busy" | "reused"
  provider: string | null
  rowCount: number
  changed: boolean
}

class ProviderRangeFetchError extends Error {}
class ProviderRangePersistenceError extends Error {}

function normalizedRequest(input: CanonicalChartOhlcvRequest): CanonicalChartOhlcvRequest {
  const ticker = String(input.ticker || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new ChartDataRequestError("Invalid ticker")
  if (input.resolution !== "1m" && input.resolution !== "1D") throw new ChartDataRequestError("Unsupported canonical resolution")
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to) || input.from <= 0 || input.to <= input.from) {
    throw new ChartDataRequestError("Invalid chart range")
  }
  const maxSpan = input.resolution === "1m" ? MAX_INTRADAY_SPAN_SECONDS : MAX_DAILY_SPAN_SECONDS
  if (input.to - input.from > maxSpan) throw new ChartDataRequestError("Chart range is too large")
  return { ...input, ticker }
}

function rowToBar(row: Record<string, unknown>): CanonicalOhlcvBar | null {
  const timestamp = row.bar_time ? new Date(String(row.bar_time)).getTime() : NaN
  const bar = {
    time: Math.floor(timestamp / 1000),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }
  return Number.isFinite(timestamp) ? bar : null
}

function laterTime(current: number | null, bars: CanonicalOhlcvBar[]) {
  const latest = bars.at(-1)?.time
  return latest == null ? current : Math.max(current ?? latest, latest)
}

function addVietnamCalendarDay(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return vietnamDateKey(date)
}

function canonicalDailyTime(dateKey: string) {
  return Math.floor(new Date(`${dateKey}T09:00:00+07:00`).getTime() / 1000)
}

function detectDailySessionGaps(bars: CanonicalOhlcvBar[]): ChartDataGap[] {
  const gaps: ChartDataGap[] = []
  for (let index = 1; index < bars.length; index += 1) {
    const previousKey = vietnamDateKey(bars[index - 1].time * 1000)
    const currentKey = vietnamDateKey(bars[index].time * 1000)
    let cursor = addVietnamCalendarDay(previousKey)
    let firstMissing: string | null = null
    let lastMissing: string | null = null
    let missingBars = 0
    let guard = 0

    while (cursor < currentKey && guard < 3700) {
      if (hasVietnamSecuritiesTradingCalendarCoverage(cursor) && isVietnamSecuritiesTradingDateKey(cursor)) {
        firstMissing ??= cursor
        lastMissing = cursor
        missingBars += 1
      }
      cursor = addVietnamCalendarDay(cursor)
      guard += 1
    }

    if (firstMissing && lastMissing && missingBars > 0) {
      gaps.push({
        fromTime: canonicalDailyTime(firstMissing),
        toTime: canonicalDailyTime(lastMissing),
        missingBars,
      })
    }
  }
  return gaps
}

function validDailyTradingBar(bar: CanonicalOhlcvBar) {
  return isVietnamSecuritiesTradingDateKey(vietnamDateKey(bar.time * 1000))
}

async function loadDailyRows(supabase: SupabaseClient, request: CanonicalChartOhlcvRequest) {
  const rows: Array<Record<string, unknown>> = []
  for (let offset = 0; ; offset += DAILY_READ_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("market_ohlcv_history")
      .select("bar_time,open,high,low,close,volume,provider,provider_detail,source_url")
      .eq("ticker", request.ticker)
      .eq("timeframe", "1D")
      .gte("bar_time", new Date(request.from * 1000).toISOString())
      .lte("bar_time", new Date(request.to * 1000).toISOString())
      .order("bar_time", { ascending: true })
      .range(offset, offset + DAILY_READ_PAGE_SIZE - 1)
    if (error) throw new ChartDataUnavailableError("Canonical Daily PostgreSQL storage unavailable")
    const page = (data || []) as Array<Record<string, unknown>>
    rows.push(...page)
    if (page.length < DAILY_READ_PAGE_SIZE) break
  }
  return rows
}

async function loadDaily(deps: ChartDataServiceDeps, request: CanonicalChartOhlcvRequest, now = new Date()): Promise<CanonicalChartOhlcvResult> {
  const hotRows = await loadDailyRows(deps.supabase, request)
  const errors: ChartDataError[] = []
  const usableHotRows = hotRows.filter(isCanonicalDailyHotRowUsable)
  if (usableHotRows.length !== hotRows.length) errors.push({ code: "INTEGRITY_WARNING" })

  const tagged: SourceTaggedBar[] = usableHotRows
    .map((row) => rowToBar(row))
    .filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
    .filter(validDailyTradingBar)
    .map((bar) => ({ source: "daily" as const, bar }))

  const normalized = normalizeCanonicalBars(tagged)
  const gaps = detectDailySessionGaps(normalized.bars)
  if (normalized.integrityIssues.length) errors.push({ code: "INTEGRITY_WARNING" })
  const uniqueErrors = [...new Map(errors.map((item) => [item.code, item])).values()]
  const complete = normalized.bars.length > 0
    && gaps.length === 0
    && normalized.integrityIssues.length === 0
    && uniqueErrors.length === 0

  return {
    ...request,
    bars: normalized.bars,
    gaps,
    integrityIssues: normalized.integrityIssues,
    coverage: {
      complete,
      state: complete ? "COMPLETE" : "PARTIAL",
    },
    errors: uniqueErrors,
    metadata: {
      priceBasis: "RAW",
      provider: "CANONICAL_DAILY_POSTGRES",
      lastUpdatedAt: now.toISOString(),
      sessionState: "CLOSED",
      currentBarTime: null,
      persistedThrough: normalized.bars.at(-1)?.time ?? null,
    },
  }
}

async function fetchClosedProviderValue(
  provider: ChartOhlcvProvider,
  request: CanonicalChartOhlcvRequest,
  range: ProviderCoverageRange,
) {
  let providerResult
  try {
    providerResult = normalizeChartProviderResult(
      await provider.fetch({ ...request, from: range.from, to: range.to, includeCurrent: false }),
      "CUSTOM",
    )
  } catch (error) {
    throw new ProviderRangeFetchError(error instanceof Error ? error.message : "Provider closed-range fetch failed")
  }
  const bars = providerResult.bars.filter((bar) => bar.time >= range.from && bar.time <= range.to)
  if (!bars.length) throw new ProviderRangeFetchError("Provider returned no usable closed 1m bars")
  return {
    provider: providerResult.provider,
    bars,
    contentId: canonicalProviderRangeContentId({
      provider: providerResult.provider,
      requestedFrom: range.from,
      requestedTo: range.to,
      bars,
    }),
  }
}

async function persistClosedProviderValue(
  deps: ChartDataServiceDeps,
  request: CanonicalChartOhlcvRequest,
  range: ProviderCoverageRange,
  now: Date,
  value: Awaited<ReturnType<typeof fetchClosedProviderValue>>,
) {
  try {
    const persisted = await upsertHotIntradayBars(deps.supabase, {
      ticker: request.ticker,
      bars: value.bars,
      provider: value.provider,
      fetchedAt: now.toISOString(),
      detail: {
        resolution: "1m",
        requestedFrom: range.from,
        requestedTo: range.to,
        liveTail: false,
        workflow: "QEO-148",
      },
    })
    if (!persisted.batchId || persisted.rowCount !== value.bars.length) {
      throw new Error("Closed-range persistence is missing exact provenance evidence")
    }
    return persisted
  } catch (error) {
    throw new ProviderRangePersistenceError(error instanceof Error ? error.message : "Closed-range persistence failed")
  }
}

async function runClosedProviderRange(
  deps: ChartDataServiceDeps,
  request: CanonicalChartOhlcvRequest,
  range: ProviderCoverageRange,
  now: Date,
  revalidate: boolean,
): Promise<ClosedRangeIngestionResult<ClosedProviderValue>> {
  const provider = deps.provider ?? createPrimaryChartOhlcvProvider()
  const coordinator = {
    claim: (input: Parameters<typeof claimChartIntradayRange>[1]) => claimChartIntradayRange(deps.supabase, input),
    complete: (input: Parameters<typeof completeChartIntradayRange>[1]) => completeChartIntradayRange(deps.supabase, input),
    abandon: (input: Parameters<typeof abandonChartIntradayRange>[1]) => abandonChartIntradayRange(deps.supabase, input),
  }

  const work = async (claim: Extract<Awaited<ReturnType<typeof claimChartIntradayRange>>, { status: "claimed" }>) => {
    const fetched = await fetchClosedProviderValue(provider, request, range)
    if (revalidate && claim.previousContentId === fetched.contentId && claim.previousProvenanceBatchId) {
      return {
        value: { provider: fetched.provider, bars: fetched.bars, persisted: false, changed: false },
        completion: {
          provider: fetched.provider,
          rowCount: fetched.bars.length,
          provenanceBatchId: claim.previousProvenanceBatchId,
          contentId: fetched.contentId,
        },
      }
    }

    const persisted = await persistClosedProviderValue(deps, request, range, now, fetched)
    return {
      value: { provider: fetched.provider, bars: fetched.bars, persisted: true, changed: true },
      completion: {
        provider: fetched.provider,
        rowCount: persisted.rowCount,
        provenanceBatchId: persisted.batchId,
        contentId: fetched.contentId,
      },
    }
  }

  try {
    return await runClosedRangeIngestion({
      ticker: request.ticker,
      sourceKey: CHART_PROVIDER_SOURCE_KEY,
      from: range.from,
      to: range.to,
      revalidate,
    }, coordinator, work)
  } catch (error) {
    if (!(error instanceof ChartClosedRangeCoordinationUnavailableError)) throw error
    // Pending-schema compatibility: never infer success from legacy provenance.
    // Until the QEO-148 migration is explicitly promoted, preserve chart
    // availability with the old uncoordinated write path and no success reuse.
    const fetched = await fetchClosedProviderValue(provider, request, range)
    const persisted = await persistClosedProviderValue(deps, request, range, now, fetched)
    return {
      status: "completed",
      claim: {
        status: "claimed",
        rangeId: "qeo148-schema-unavailable",
        leaseOwner: "qeo148-schema-unavailable",
        fence: 1,
        previousContentId: null,
        previousProvenanceBatchId: null,
      },
      value: { provider: fetched.provider, bars: fetched.bars, persisted: persisted.rowCount > 0, changed: true },
    }
  }
}

function clipRange(range: ProviderCoverageRange, bounds: ProviderCoverageRange): ProviderCoverageRange | null {
  const from = Math.max(range.from, bounds.from)
  const to = Math.min(range.to, bounds.to)
  return to > from ? { from, to } : null
}

async function loadIntraday(deps: ChartDataServiceDeps, request: CanonicalChartOhlcvRequest): Promise<CanonicalChartOhlcvResult> {
  const coldStorage = deps.coldStorage ?? createSupabaseColdOhlcvStorage(deps.supabase)
  const provider = deps.provider ?? createPrimaryChartOhlcvProvider()
  const errors: ChartDataError[] = []
  const now = deps.now ?? new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const currentMinuteStart = activeMinuteStart(nowSeconds)
  const session = getMarketSessionStatus(now)

  const [hotRead, coldRead, coverageRead] = await Promise.allSettled([
    readHotIntradayRange(deps.supabase, request.ticker, request.from, request.to),
    coldStorage.readIntersectingRange({ ticker: request.ticker, from: request.from, to: request.to }),
    readProviderRequestCoverage(deps.supabase, request.ticker, request.from, request.to),
  ])

  const tagged: SourceTaggedBar[] = []
  let durablePersistedThrough: number | null = null
  if (hotRead.status === "fulfilled") {
    const durableHotBars = session.isLiveSession
      ? hotRead.value.filter((bar) => bar.time < currentMinuteStart)
      : hotRead.value
    tagged.push(...durableHotBars.map((bar) => ({ source: "hot" as const, bar })))
    durablePersistedThrough = laterTime(durablePersistedThrough, durableHotBars)
  } else {
    errors.push({ code: "STORAGE_UNAVAILABLE" })
  }
  if (coldRead.status === "fulfilled") {
    tagged.push(...coldRead.value.bars.map((bar) => ({ source: "cold" as const, bar })))
    durablePersistedThrough = laterTime(durablePersistedThrough, coldRead.value.bars)
  } else {
    errors.push({ code: "STORAGE_UNAVAILABLE" })
  }

  let normalized = normalizeCanonicalBars(tagged)
  const effectiveTo = Math.min(request.to, nowSeconds)
  const liveTailRange = session.isLiveSession && effectiveTo > request.from
    ? {
        from: Math.max(request.from, currentMinuteStart - LIVE_TAIL_SECONDS),
        to: effectiveTo,
      }
    : null
  const closedRequestedRange = effectiveTo > request.from
    ? {
        from: request.from,
        to: liveTailRange && liveTailRange.from < liveTailRange.to
          ? Math.min(effectiveTo, liveTailRange.from - 1)
          : effectiveTo,
      }
    : null
  const coveredRanges = coverageRead.status === "fulfilled" ? coverageRead.value : []
  if (coverageRead.status === "rejected") errors.push({ code: "STORAGE_UNAVAILABLE" })

  const closedUncoveredRanges = closedRequestedRange && closedRequestedRange.to > closedRequestedRange.from
    ? missingTradingProviderRanges(closedRequestedRange, coveredRanges)
    : []
  const closedStorageGapRanges = closedRequestedRange && closedRequestedRange.to > closedRequestedRange.from
    ? detectTradingSessionGaps(normalized.bars)
        .map((gap) => clipRange({ from: gap.fromTime, to: gap.toTime }, closedRequestedRange))
        .filter((range): range is ProviderCoverageRange => Boolean(range))
    : []
  const closedProviderRanges = mergeProviderRanges([
    ...closedUncoveredRanges,
    ...uncoveredProviderRanges(closedStorageGapRanges, coveredRanges),
  ])

  let latestProvider: string | null = null
  for (const range of closedProviderRanges) {
    try {
      const result = await runClosedProviderRange(deps, request, range, now, false)
      if (result.status === "completed") {
        latestProvider = result.value.provider
        tagged.push(...result.value.bars.map((bar) => ({ source: "provider" as const, bar })))
        if (result.value.persisted) durablePersistedThrough = laterTime(durablePersistedThrough, result.value.bars)
        normalized = normalizeCanonicalBars(tagged)
      } else if (result.status === "reused") {
        try {
          const refreshed = await readHotIntradayRange(deps.supabase, request.ticker, range.from, range.to)
          tagged.push(...refreshed.map((bar) => ({ source: "hot" as const, bar })))
          durablePersistedThrough = laterTime(durablePersistedThrough, refreshed)
          normalized = normalizeCanonicalBars(tagged)
        } catch {
          errors.push({ code: "STORAGE_UNAVAILABLE" })
        }
      }
    } catch (error) {
      errors.push({ code: error instanceof ProviderRangeFetchError ? "PROVIDER_UNAVAILABLE" : "STORAGE_UNAVAILABLE" })
    }
  }

  if (liveTailRange && liveTailRange.from < liveTailRange.to) {
    try {
      const providerResult = normalizeChartProviderResult(
        await provider.fetch({
          ...request,
          from: liveTailRange.from,
          to: liveTailRange.to,
          includeCurrent: true,
        }),
        "CUSTOM",
      )
      const partition = partitionLiveMinuteBars(providerResult.bars, currentMinuteStart, true)
      if (!partition.responseBars.length) throw new ProviderRangeFetchError("Provider returned no usable live-tail 1m bars")
      latestProvider = providerResult.provider
      tagged.push(...partition.responseBars.map((bar) => ({ source: "provider" as const, bar })))
      normalized = normalizeCanonicalBars(tagged)

      if (partition.completedBars.length) {
        try {
          await upsertHotIntradayBars(deps.supabase, {
            ticker: request.ticker,
            bars: partition.completedBars,
            provider: providerResult.provider,
            fetchedAt: now.toISOString(),
            detail: {
              resolution: "1m",
              requestedFrom: liveTailRange.from,
              requestedTo: Math.min(liveTailRange.to, currentMinuteStart - 1),
              liveTail: true,
            },
          })
          durablePersistedThrough = laterTime(durablePersistedThrough, partition.completedBars)
        } catch {
          errors.push({ code: "STORAGE_UNAVAILABLE" })
        }
      }
    } catch {
      errors.push({ code: "PROVIDER_UNAVAILABLE" })
    }
  }

  if (!normalized.bars.length && errors.some((item) => item.code === "PROVIDER_UNAVAILABLE")) {
    throw new ChartDataUnavailableError("Canonical intraday data unavailable")
  }

  const gaps = detectTradingSessionGaps(normalized.bars)
  if (normalized.integrityIssues.length) errors.push({ code: "INTEGRITY_WARNING" })
  const uniqueErrors = [...new Map(errors.map((item) => [item.code, item])).values()]
  const complete = normalized.bars.length > 0 && gaps.length === 0 && normalized.integrityIssues.length === 0 && uniqueErrors.length === 0
  const currentBar = session.isLiveSession
    ? normalized.bars.find((bar) => bar.time === currentMinuteStart) ?? null
    : null

  return {
    ...request,
    bars: normalized.bars,
    gaps,
    integrityIssues: normalized.integrityIssues,
    coverage: { complete, state: complete ? "COMPLETE" : "PARTIAL" },
    errors: uniqueErrors,
    metadata: {
      priceBasis: "RAW",
      provider: latestProvider,
      lastUpdatedAt: now.toISOString(),
      sessionState: session.isLiveSession ? "LIVE" : "CLOSED",
      currentBarTime: currentBar?.time ?? null,
      persistedThrough: durablePersistedThrough,
    },
  }
}

/**
 * Explicit correction path for QEO-150/repair callers. Ordinary chart reads
 * never set revalidate=true. An identical source-aware content identity reuses
 * the previous provenance; a genuine revision is written and auditable before
 * the durable success marker is replaced.
 */
export async function revalidateClosedIntradayRange(
  deps: ChartDataServiceDeps,
  input: CanonicalChartOhlcvRequest,
): Promise<ClosedIntradayRevalidationResult> {
  const request = normalizedRequest(input)
  if (request.resolution !== "1m") throw new ChartDataRequestError("Correction revalidation requires canonical 1m")
  const now = deps.now ?? new Date()
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const currentMinuteStart = activeMinuteStart(nowSeconds)
  const session = getMarketSessionStatus(now)
  const closedTo = session.isLiveSession ? Math.min(request.to, currentMinuteStart - 1) : Math.min(request.to, nowSeconds)
  if (closedTo <= request.from) throw new ChartDataRequestError("Correction revalidation requires a closed range")

  const result = await runClosedProviderRange(deps, request, { from: request.from, to: closedTo }, now, true)
  if (result.status !== "completed") {
    return { status: result.status, provider: null, rowCount: 0, changed: false }
  }
  return {
    status: "completed",
    provider: result.value.provider,
    rowCount: result.value.bars.length,
    changed: result.value.changed,
  }
}

export async function getCanonicalChartOhlcv(
  deps: ChartDataServiceDeps,
  input: CanonicalChartOhlcvRequest,
): Promise<CanonicalChartOhlcvResult> {
  const request = normalizedRequest(input)
  const now = deps.now ?? new Date()
  return request.resolution === "1D" ? loadDaily(deps, request, now) : loadIntraday(deps, request)
}
