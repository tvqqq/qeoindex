import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { chartHotSessionRetentionCutoff } from "./history-policy"
import {
  abandonChartIntradayRange,
  canonicalProviderRangeContentId,
  claimChartIntradayRange,
  completeChartIntradayRange,
  recordChartProviderAttempt,
  upsertHotIntradayBars,
} from "./hot-store"
import {
  classifyQeo150Freshness,
  expectedCompletedVietnamSession,
  qeo150SessionRange,
  type Qeo150AttemptOutcome,
  type Qeo150DailyEvidence,
  type Qeo150EvidenceCategory,
} from "./maintenance-policy"
import {
  ChartOhlcvProviderWaterfallError,
  createPrimaryChartOhlcvProvider,
  normalizeChartProviderResult,
  type ChartOhlcvProvider,
} from "./provider"
import { CHART_PROVIDER_SOURCE_KEY, runClosedRangeIngestion } from "./provider-ingestion"

const ATTEMPT_READ_PAGE_SIZE = 500
const ATTEMPT_READ_MAX_PAGES = 8

export interface Qeo150FreshnessRow {
  ticker: string
  expectedSession: string
  actualSession: string | null
  current: boolean
  evidenceCategory: Qeo150EvidenceCategory
  dailyEvidence: Qeo150DailyEvidence | null
  lastAttemptOutcome: Qeo150AttemptOutcome
  lastAttemptAt: string | null
  lastDispatchId: string | null
}

export interface Qeo150IngestionResult {
  ticker: string
  outcome: Extract<Qeo150AttemptOutcome, "ingested" | "reused" | "provider_gap" | "retryable_failure" | "failed">
  provider: string | null
  rowCount: number
  error: string | null
}

class Qeo150ProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: Extract<Qeo150AttemptOutcome, "provider_gap" | "retryable_failure" | "failed">,
    readonly failureCodes: string[],
  ) {
    super(message)
    this.name = "Qeo150ProviderError"
  }
}

function validTicker(input: string) {
  const ticker = String(input || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid QEO-150 ticker: ${input}`)
  return ticker
}

function nullableString(value: unknown) {
  return value == null || value === "" ? null : String(value)
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function dayBounds(sessionDate: string) {
  const from = Date.parse(`${sessionDate}T00:00:00+07:00`)
  const to = from + 24 * 60 * 60 * 1000
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
}

async function readLatestQeo150Attempts(supabase: SupabaseClient, tickers: string[]) {
  const latest = new Map<string, { outcome: Qeo150AttemptOutcome; fetchedAt: string | null; dispatchId: string | null }>()
  if (!tickers.length) return latest

  for (let page = 0; page < ATTEMPT_READ_MAX_PAGES; page += 1) {
    const offset = page * ATTEMPT_READ_PAGE_SIZE
    const { data, error } = await supabase
      .from("chart_ohlcv_provenance_batches")
      .select("id,ticker,fetched_at,detail")
      .in("ticker", tickers)
      .eq("base_resolution", "1m")
      .contains("detail", { workflow: "QEO-150" })
      .order("fetched_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + ATTEMPT_READ_PAGE_SIZE - 1)
    if (error) throw new Error(`QEO-150 attempt evidence read failed: ${error.message}`)

    const rows = (data || []) as Array<Record<string, unknown>>
    for (const row of rows) {
      const ticker = validTicker(String(row.ticker || ""))
      if (latest.has(ticker)) continue
      const detail = row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
        ? row.detail as Record<string, unknown>
        : {}
      const rawOutcome = String(detail.outcome || "none") as Qeo150AttemptOutcome
      const allowed: Qeo150AttemptOutcome[] = [
        "already_fresh",
        "ingested",
        "reused",
        "no_trade",
        "suspension",
        "provider_gap",
        "retryable_failure",
        "failed",
        "capacity_stop",
        "sla_timeout",
        "unknown",
      ]
      latest.set(ticker, {
        outcome: allowed.includes(rawOutcome) ? rawOutcome : "none",
        fetchedAt: nullableString(row.fetched_at),
        dispatchId: nullableString(detail.dispatchId),
      })
    }
    if (rows.length < ATTEMPT_READ_PAGE_SIZE || latest.size === tickers.length) break
  }
  return latest
}

async function readExpectedDailyEvidence(
  supabase: SupabaseClient,
  tickers: string[],
  expectedSession: string,
) {
  const bounds = dayBounds(expectedSession)
  const { data, error } = await supabase
    .from("market_ohlcv_history")
    .select("ticker,bar_time,volume,provider,provider_detail,source_url")
    .in("ticker", tickers)
    .eq("timeframe", "1D")
    .gte("bar_time", bounds.from)
    .lt("bar_time", bounds.to)
    .order("bar_time", { ascending: false })
  if (error) throw new Error(`QEO-150 Daily evidence read failed: ${error.message}`)

  const byTicker = new Map<string, Qeo150DailyEvidence>()
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const ticker = validTicker(String(row.ticker || ""))
    if (byTicker.has(ticker)) continue
    const volume = finiteNumber(row.volume)
    if (volume == null || volume < 0) continue
    byTicker.set(ticker, {
      volume,
      provider: nullableString(row.provider),
      providerDetail: nullableString(row.provider_detail),
      sourceUrl: nullableString(row.source_url),
    })
  }
  return byTicker
}

async function readActualHotSessions(
  supabase: SupabaseClient,
  tickers: string[],
  referenceAt: Date,
) {
  const { data, error } = await supabase.rpc("qeo_chart_intraday_session_coverage", {
    p_tickers: tickers,
    p_hot_cutoff: new Date(chartHotSessionRetentionCutoff(referenceAt) * 1000).toISOString(),
  })
  if (error) throw new Error(`QEO-150 HOT session coverage failed: ${error.message}`)
  const byTicker = new Map<string, string | null>()
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const ticker = validTicker(String(row.ticker || ""))
    byTicker.set(ticker, nullableString(row.last_hot_session))
  }
  return byTicker
}

export async function readChartIntradayMaintenanceReport(
  supabase: SupabaseClient,
  input: {
    tickers: string[]
    referenceAt?: Date
    expectedSession?: string
    outcomeOverrides?: Map<string, Qeo150AttemptOutcome>
    dispatchId?: string | null
  },
): Promise<Qeo150FreshnessRow[]> {
  const tickers = [...new Set(input.tickers.map(validTicker))]
  if (!tickers.length) return []
  const referenceAt = input.referenceAt ?? new Date()
  const expectedSession = input.expectedSession ?? expectedCompletedVietnamSession(referenceAt)
  const [actualByTicker, dailyByTicker, attemptsByTicker] = await Promise.all([
    readActualHotSessions(supabase, tickers, referenceAt),
    readExpectedDailyEvidence(supabase, tickers, expectedSession),
    readLatestQeo150Attempts(supabase, tickers),
  ])

  return tickers.map((ticker) => {
    const actualSession = actualByTicker.get(ticker) ?? null
    const dailyEvidence = dailyByTicker.get(ticker) ?? null
    const persistedAttempt = attemptsByTicker.get(ticker)
    const override = input.outcomeOverrides?.get(ticker)
    const lastAttemptOutcome = override ?? persistedAttempt?.outcome ?? "none"
    const classification = classifyQeo150Freshness({
      expectedSession,
      actualSession,
      dailyEvidence,
      lastAttemptOutcome,
    })
    const derivedOutcome: Qeo150AttemptOutcome = classification.current && lastAttemptOutcome === "none"
      ? "already_fresh"
      : classification.evidenceCategory === "no_trade" && lastAttemptOutcome === "none"
        ? "no_trade"
        : classification.evidenceCategory === "suspension" && lastAttemptOutcome === "none"
          ? "suspension"
          : lastAttemptOutcome
    return {
      ticker,
      expectedSession,
      actualSession,
      current: classification.current,
      evidenceCategory: classification.evidenceCategory,
      dailyEvidence,
      lastAttemptOutcome: derivedOutcome,
      lastAttemptAt: persistedAttempt?.fetchedAt ?? null,
      lastDispatchId: override ? input.dispatchId ?? null : persistedAttempt?.dispatchId ?? null,
    }
  })
}

export async function recordQeo150OutcomeEvidence(
  supabase: SupabaseClient,
  input: {
    ticker: string
    expectedSession: string
    dispatchId: string
    outcome: Exclude<Qeo150AttemptOutcome, "none">
    error?: string | null
    failureCodes?: string[]
    provider?: string | null
    rowCount?: number
  },
) {
  const ticker = validTicker(input.ticker)
  const range = qeo150SessionRange(input.expectedSession)
  await recordChartProviderAttempt(supabase, {
    ticker,
    provider: input.provider?.trim() || "QEO150_MAINTENANCE",
    requestedFrom: range.from,
    requestedTo: range.to,
    detail: {
      workflow: "QEO-150",
      dispatchId: input.dispatchId,
      expectedSession: input.expectedSession,
      outcome: input.outcome,
      error: (input.error ?? "").slice(0, 240),
      failureCodes: input.failureCodes ?? [],
      observedRowCount: input.rowCount ?? 0,
    },
  })
}

function providerFailure(error: unknown) {
  if (error instanceof ChartOhlcvProviderWaterfallError) {
    const outcome: Extract<Qeo150AttemptOutcome, "provider_gap" | "retryable_failure" | "failed"> = error.terminalCoverageGap
      ? "provider_gap"
      : error.retryable
        ? "retryable_failure"
        : "failed"
    return new Qeo150ProviderError(
      error.message,
      outcome,
      error.failures.map((failure) => `${failure.provider}:${failure.code}`),
    )
  }
  return new Qeo150ProviderError(
    error instanceof Error ? error.message : String(error ?? "Provider failure"),
    "failed",
    [],
  )
}

export async function ingestClosedIntradayRange(
  supabase: SupabaseClient,
  input: {
    ticker: string
    expectedSession: string
    dispatchId: string
    referenceAt?: Date
    provider?: ChartOhlcvProvider
  },
): Promise<Qeo150IngestionResult> {
  const ticker = validTicker(input.ticker)
  const referenceAt = input.referenceAt ?? new Date()
  const range = qeo150SessionRange(input.expectedSession)
  const provider = input.provider ?? createPrimaryChartOhlcvProvider()
  const coordinator = {
    claim: (claimInput: Parameters<typeof claimChartIntradayRange>[1]) => claimChartIntradayRange(supabase, claimInput),
    complete: (completionInput: Parameters<typeof completeChartIntradayRange>[1]) => completeChartIntradayRange(supabase, completionInput),
    abandon: (abandonInput: Parameters<typeof abandonChartIntradayRange>[1]) => abandonChartIntradayRange(supabase, abandonInput),
  }

  try {
    const coordinated = await runClosedRangeIngestion({
      ticker,
      sourceKey: CHART_PROVIDER_SOURCE_KEY,
      from: range.from,
      to: range.to,
      revalidate: false,
      maxClaimAttempts: 3,
    }, coordinator, async () => {
      let providerResult
      try {
        providerResult = normalizeChartProviderResult(await provider.fetch({
          ticker,
          resolution: "1m",
          from: range.from,
          to: range.to,
          includeCurrent: false,
        }), "CUSTOM")
      } catch (error) {
        throw providerFailure(error)
      }

      const bars = [...providerResult.bars]
        .filter((bar) => bar.time >= range.from && bar.time <= range.to)
        .sort((left, right) => left.time - right.time)
      if (!bars.length) {
        throw new Qeo150ProviderError(
          `${providerResult.provider} returned no usable canonical 1m bars for ${input.expectedSession}`,
          "provider_gap",
          [`${providerResult.provider}:EMPTY_COVERAGE`],
        )
      }

      const persisted = await upsertHotIntradayBars(supabase, {
        ticker,
        bars,
        provider: providerResult.provider,
        fetchedAt: referenceAt.toISOString(),
        detail: {
          workflow: "QEO-150",
          dispatchId: input.dispatchId,
          expectedSession: input.expectedSession,
          outcome: "ingested",
          requestedFrom: range.from,
          requestedTo: range.to,
          liveTail: false,
        },
      })
      if (!persisted.batchId || persisted.rowCount !== bars.length) {
        throw new Error("QEO-150 canonical persistence is missing exact provenance evidence")
      }

      return {
        value: {
          provider: providerResult.provider,
          rowCount: bars.length,
        },
        completion: {
          provider: providerResult.provider,
          rowCount: bars.length,
          provenanceBatchId: persisted.batchId,
          contentId: canonicalProviderRangeContentId({
            provider: providerResult.provider,
            requestedFrom: range.from,
            requestedTo: range.to,
            bars,
          }),
        },
      }
    })

    if (coordinated.status === "reused") {
      await recordQeo150OutcomeEvidence(supabase, {
        ticker,
        expectedSession: input.expectedSession,
        dispatchId: input.dispatchId,
        outcome: "reused",
      })
      return { ticker, outcome: "reused", provider: null, rowCount: 0, error: null }
    }
    if (coordinated.status === "busy") {
      const error = "QEO-148 closed-range claim remained busy after bounded retries"
      await recordQeo150OutcomeEvidence(supabase, {
        ticker,
        dispatchId: input.dispatchId,
        expectedSession: input.expectedSession,
        outcome: "retryable_failure",
        error,
        failureCodes: ["QEO-148:RANGE_BUSY"],
      })
      return { ticker, outcome: "retryable_failure", provider: null, rowCount: 0, error }
    }
    return {
      ticker,
      outcome: "ingested",
      provider: coordinated.value.provider,
      rowCount: coordinated.value.rowCount,
      error: null,
    }
  } catch (error) {
    const classified = error instanceof Qeo150ProviderError
      ? error
      : new Qeo150ProviderError(error instanceof Error ? error.message : String(error ?? "QEO-150 ingestion failure"), "failed", [])
    try {
      await recordQeo150OutcomeEvidence(supabase, {
        ticker,
        dispatchId: input.dispatchId,
        expectedSession: input.expectedSession,
        outcome: classified.outcome,
        error: classified.message,
        failureCodes: classified.failureCodes,
      })
    } catch {
      // Failure evidence must not turn a failed ingestion into success.
    }
    return {
      ticker,
      outcome: classified.outcome,
      provider: null,
      rowCount: 0,
      error: classified.message,
    }
  }
}

export async function recordQeo150CapacityStop(
  supabase: SupabaseClient,
  input: { ticker: string; expectedSession: string; dispatchId: string; reason: string },
) {
  try {
    await recordQeo150OutcomeEvidence(supabase, {
      ticker: input.ticker,
      dispatchId: input.dispatchId,
      expectedSession: input.expectedSession,
      outcome: "capacity_stop",
      error: input.reason,
    })
  } catch {
    // Capacity remains fail-closed even if telemetry persistence is unavailable.
  }
}
