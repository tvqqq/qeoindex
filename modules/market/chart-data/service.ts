import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "@/modules/market/calendar"
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
import { readHotIntradayRange, readProviderRequestCoverage, upsertHotIntradayBars } from "./hot-store"
import { activeMinuteStart, partitionLiveMinuteBars } from "./live-session"
import { detectTradingSessionGaps, normalizeCanonicalBars } from "./normalize"
import {
  createPrimaryChartOhlcvProvider,
  normalizeChartProviderResult,
  type ChartOhlcvProvider,
} from "./provider"
import { mergeProviderRanges, missingProviderRanges, uncoveredProviderRanges } from "./provider-coverage"

const DAY_SECONDS = 86400
const MAX_INTRADAY_SPAN_SECONDS = 31 * DAY_SECONDS
const MAX_DAILY_SPAN_SECONDS = 100 * 366 * DAY_SECONDS
const LIVE_TAIL_SECONDS = 5 * 60
const DAILY_STORAGE_PAGE_SIZE = 1000

export interface ChartDataServiceDeps {
  supabase: SupabaseClient
  coldStorage?: ColdOhlcvStorage
  provider?: ChartOhlcvProvider
  now?: Date
}

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
      if (isVietnamSecuritiesTradingDateKey(cursor)) {
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

async function loadDailyRows(supabase: SupabaseClient, request: CanonicalChartOhlcvRequest) {
  const rows: Array<Record<string, unknown>> = []
  for (let offset = 0; ; offset += DAILY_STORAGE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("market_ohlcv_history")
      .select("bar_time,open,high,low,close,volume")
      .eq("ticker", request.ticker)
      .eq("timeframe", "1D")
      .gte("bar_time", new Date(request.from * 1000).toISOString())
      .lte("bar_time", new Date(request.to * 1000).toISOString())
      .order("bar_time", { ascending: true })
      .range(offset, offset + DAILY_STORAGE_PAGE_SIZE - 1)
    if (error) throw new ChartDataUnavailableError("Canonical Daily storage unavailable")
    const page = (data || []) as Array<Record<string, unknown>>
    rows.push(...page)
    if (page.length < DAILY_STORAGE_PAGE_SIZE) break
  }
  return rows
}

async function loadDaily(supabase: SupabaseClient, request: CanonicalChartOhlcvRequest, now = new Date()): Promise<CanonicalChartOhlcvResult> {
  const rows = await loadDailyRows(supabase, request)
  const tagged: SourceTaggedBar[] = rows
    .map((row) => rowToBar(row))
    .filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
    .filter((bar) => isVietnamSecuritiesTradingDateKey(vietnamDateKey(bar.time * 1000)))
    .map((bar) => ({ source: "daily" as const, bar }))
  const normalized = normalizeCanonicalBars(tagged)
  const gaps = detectDailySessionGaps(normalized.bars)
  const complete = normalized.bars.length > 0 && gaps.length === 0 && normalized.integrityIssues.length === 0
  return {
    ...request,
    bars: normalized.bars,
    gaps,
    integrityIssues: normalized.integrityIssues,
    coverage: {
      complete,
      state: complete ? "COMPLETE" : "PARTIAL",
    },
    errors: normalized.integrityIssues.length ? [{ code: "INTEGRITY_WARNING" }] : [],
    metadata: {
      priceBasis: "RAW",
      provider: "CANONICAL_DAILY",
      lastUpdatedAt: now.toISOString(),
      sessionState: "CLOSED",
      currentBarTime: null,
      persistedThrough: normalized.bars.at(-1)?.time ?? null,
    },
  }
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
  const requestedRange = { from: request.from, to: effectiveTo }
  const coveredRanges = coverageRead.status === "fulfilled" ? coverageRead.value : []
  const uncoveredRanges = normalized.bars.length === 0
    ? [requestedRange]
    : missingProviderRanges(requestedRange, coveredRanges)
  const storageGapRanges = detectTradingSessionGaps(normalized.bars).map((gap) => ({
    from: gap.fromTime,
    to: gap.toTime,
  }))
  const uncoveredStorageGapRanges = uncoveredProviderRanges(storageGapRanges, coveredRanges)
  const liveTailRange = session.isLiveSession && effectiveTo > request.from
    ? {
        from: Math.max(request.from, currentMinuteStart - LIVE_TAIL_SECONDS),
        to: effectiveTo,
      }
    : null
  const providerRanges = effectiveTo > request.from
    ? mergeProviderRanges([
        ...uncoveredRanges,
        ...uncoveredStorageGapRanges,
        ...(liveTailRange && liveTailRange.from < liveTailRange.to ? [liveTailRange] : []),
      ])
    : []

  let latestProvider: string | null = null
  for (const range of providerRanges) {
    try {
      const providerResult = normalizeChartProviderResult(
        await provider.fetch({
          ...request,
          from: range.from,
          to: range.to,
          includeCurrent: session.isLiveSession,
        }),
        "CUSTOM",
      )
      const partition = partitionLiveMinuteBars(providerResult.bars, currentMinuteStart, session.isLiveSession)
      const providerBars = partition.responseBars
      if (!providerBars.length) throw new Error("Provider returned no usable 1m bars")
      latestProvider = providerResult.provider
      tagged.push(...providerBars.map((bar) => ({ source: "provider" as const, bar })))
      normalized = normalizeCanonicalBars(tagged)

      if (partition.completedBars.length) {
        try {
          const completedRequestedTo = session.isLiveSession
            ? Math.min(range.to, currentMinuteStart - 1)
            : range.to
          await upsertHotIntradayBars(deps.supabase, {
            ticker: request.ticker,
            bars: partition.completedBars,
            provider: providerResult.provider,
            fetchedAt: now.toISOString(),
            detail: {
              resolution: "1m",
              requestedFrom: range.from,
              requestedTo: completedRequestedTo,
              liveTail: session.isLiveSession,
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

export async function getCanonicalChartOhlcv(
  deps: ChartDataServiceDeps,
  input: CanonicalChartOhlcvRequest,
): Promise<CanonicalChartOhlcvResult> {
  const request = normalizedRequest(input)
  const now = deps.now ?? new Date()
  return request.resolution === "1D" ? loadDaily(deps.supabase, request, now) : loadIntraday(deps, request)
}
