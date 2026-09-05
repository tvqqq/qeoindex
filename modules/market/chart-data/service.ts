import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { createSupabaseColdOhlcvStorage, type ColdOhlcvStorage } from "./cold-store"
import type {
  CanonicalOhlcvBar,
  ChartDataError,
  ChartOhlcvRequest,
  ChartOhlcvResult,
  SourceTaggedBar,
} from "./contract"
import { ChartDataRequestError, ChartDataUnavailableError } from "./contract"
import { readHotIntradayRange, upsertHotIntradayBars } from "./hot-store"
import { detectTradingSessionGaps, normalizeCanonicalBars } from "./normalize"
import { createPrimaryChartOhlcvProvider, type ChartOhlcvProvider } from "./provider"

const DAY_SECONDS = 86400
const MAX_INTRADAY_SPAN_SECONDS = 31 * DAY_SECONDS
const MAX_DAILY_SPAN_SECONDS = 10 * 366 * DAY_SECONDS

export interface ChartDataServiceDeps {
  supabase: SupabaseClient
  coldStorage?: ColdOhlcvStorage
  provider?: ChartOhlcvProvider
  now?: Date
}

function normalizedRequest(input: ChartOhlcvRequest): ChartOhlcvRequest {
  const ticker = String(input.ticker || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new ChartDataRequestError("Invalid ticker")
  if (input.resolution !== "1m" && input.resolution !== "1D") throw new ChartDataRequestError("Unsupported resolution")
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

async function loadDaily(supabase: SupabaseClient, request: ChartOhlcvRequest): Promise<ChartOhlcvResult> {
  const { data, error } = await supabase
    .from("market_ohlcv_history")
    .select("bar_time,open,high,low,close,volume")
    .eq("ticker", request.ticker)
    .eq("timeframe", "1D")
    .gte("bar_time", new Date(request.from * 1000).toISOString())
    .lte("bar_time", new Date(request.to * 1000).toISOString())
    .order("bar_time", { ascending: true })
  if (error) throw new ChartDataUnavailableError("Canonical Daily storage unavailable")

  const tagged: SourceTaggedBar[] = (data || [])
    .map((row) => rowToBar(row as Record<string, unknown>))
    .filter((bar): bar is CanonicalOhlcvBar => Boolean(bar))
    .map((bar) => ({ source: "daily" as const, bar }))
  const normalized = normalizeCanonicalBars(tagged)
  return {
    ...request,
    bars: normalized.bars,
    gaps: [],
    integrityIssues: normalized.integrityIssues,
    coverage: {
      complete: normalized.bars.length > 0 && normalized.integrityIssues.length === 0,
      state: normalized.bars.length > 0 && normalized.integrityIssues.length === 0 ? "COMPLETE" : "PARTIAL",
    },
    errors: normalized.integrityIssues.length ? [{ code: "INTEGRITY_WARNING" }] : [],
  }
}

async function loadIntraday(deps: ChartDataServiceDeps, request: ChartOhlcvRequest): Promise<ChartOhlcvResult> {
  const coldStorage = deps.coldStorage ?? createSupabaseColdOhlcvStorage(deps.supabase)
  const provider = deps.provider ?? createPrimaryChartOhlcvProvider()
  const errors: ChartDataError[] = []

  const [hotRead, coldRead] = await Promise.allSettled([
    readHotIntradayRange(deps.supabase, request.ticker, request.from, request.to),
    coldStorage.readIntersectingRange({ ticker: request.ticker, from: request.from, to: request.to }),
  ])

  const tagged: SourceTaggedBar[] = []
  if (hotRead.status === "fulfilled") {
    tagged.push(...hotRead.value.map((bar) => ({ source: "hot" as const, bar })))
  } else {
    errors.push({ code: "STORAGE_UNAVAILABLE" })
  }
  if (coldRead.status === "fulfilled") {
    tagged.push(...coldRead.value.bars.map((bar) => ({ source: "cold" as const, bar })))
  } else {
    errors.push({ code: "STORAGE_UNAVAILABLE" })
  }

  let normalized = normalizeCanonicalBars(tagged)
  const nowSeconds = Math.floor((deps.now ?? new Date()).getTime() / 1000)
  const effectiveTo = Math.min(request.to, nowSeconds)
  const lastStored = normalized.bars.at(-1)?.time ?? null
  const providerFrom = lastStored == null ? request.from : Math.max(request.from, lastStored + 60)
  const needsProvider = effectiveTo > providerFrom

  if (needsProvider) {
    try {
      const providerBars = await provider.fetch({ ...request, from: providerFrom, to: effectiveTo })
      tagged.push(...providerBars.map((bar) => ({ source: "provider" as const, bar })))
      normalized = normalizeCanonicalBars(tagged)
      if (providerBars.length) {
        try {
          await upsertHotIntradayBars(deps.supabase, {
            ticker: request.ticker,
            bars: providerBars,
            provider: "DNSE",
            detail: { resolution: "1m" },
          })
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

  return {
    ...request,
    bars: normalized.bars,
    gaps,
    integrityIssues: normalized.integrityIssues,
    coverage: { complete, state: complete ? "COMPLETE" : "PARTIAL" },
    errors: uniqueErrors,
  }
}

export async function getCanonicalChartOhlcv(
  deps: ChartDataServiceDeps,
  input: ChartOhlcvRequest,
): Promise<ChartOhlcvResult> {
  const request = normalizedRequest(input)
  return request.resolution === "1D" ? loadDaily(deps.supabase, request) : loadIntraday(deps, request)
}
