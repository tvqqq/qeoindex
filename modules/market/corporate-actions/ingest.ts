import type { SupabaseClient } from "@supabase/supabase-js"

import {
  hasVietnamSecuritiesTradingCalendarCoverage,
  isVietnamSecuritiesTradingDateKey,
} from "@/modules/market/calendar"
import type {
  CorporateActionExDateInput,
  NormalizedCorporateAction,
  SourceCorporateActionNotice,
} from "./contract.ts"
import { normalizeCorporateActionNotice } from "./normalize.ts"
import { persistCorporateActionNotice } from "./store.ts"
import {
  discoverVsdcCorporateActionEvents,
  type VsdcCorporateActionDiscovery,
} from "./providers/vsdc-discovery.ts"
import {
  parseVsdcCorporateActionHtml,
  vsdcEventUrl,
} from "./providers/vsdc.ts"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_DELAY_MS = 300
const NORMALIZATION_VERSION = "qeo123-v1"
const EX_DATE_METHOD = "record_date_previous_verified_trading_session"
const CALENDAR_VERSION = "vn-securities-calendar-2018-2026-v1"

export type CorporateActionIngestionSkip = {
  sourceEventId: string
  reason: "unsupported_non_adjusting_event"
}

export type FetchedCorporateActionNotice = {
  notice: SourceCorporateActionNotice
  rawPayload: { html: string }
  actions: NormalizedCorporateAction[]
}

export type CorporateActionFetchResult = {
  ticker: string
  actions: NormalizedCorporateAction[]
  notices: FetchedCorporateActionNotice[]
  skipped: CorporateActionIngestionSkip[]
}

export type CorporateActionFetchOptions = {
  asOf: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  discover?: (
    ticker: string,
    options?: { fetchImpl?: typeof fetch; requestDelayMs?: number; maxPages?: number },
  ) => Promise<VsdcCorporateActionDiscovery>
  requestDelayMs?: number
  timeoutMs?: number
  maxPages?: number
}

function validIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function normalizedTicker(value: string) {
  const ticker = value.trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error("Invalid corporate-action ticker")
  return ticker
}

function previousCalendarDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

export function deriveVerifiedCorporateActionExDate(recordDate: string | null): CorporateActionExDateInput {
  if (!recordDate
    || !hasVietnamSecuritiesTradingCalendarCoverage(recordDate)
    || !isVietnamSecuritiesTradingDateKey(recordDate)) {
    return { date: null, basis: "unknown" }
  }

  for (let offset = 1; offset <= 14; offset += 1) {
    const candidate = previousCalendarDate(recordDate, offset)
    if (!hasVietnamSecuritiesTradingCalendarCoverage(candidate)) break
    if (isVietnamSecuritiesTradingDateKey(candidate)) {
      return {
        date: candidate,
        basis: "derived",
        derivationMethod: EX_DATE_METHOD,
        tradingCalendarVersion: CALENDAR_VERSION,
      }
    }
  }

  return { date: null, basis: "unknown" }
}

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)
  const relayAbort = () => timeoutController.abort()
  signal?.addEventListener("abort", relayAbort, { once: true })

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "qeoindex-corporate-actions/1.0",
      },
      signal: timeoutController.signal,
    })
    if (!response.ok) throw new Error(`VSDC corporate-action detail HTTP ${response.status}`)
    const finalUrl = response.url || url
    const parsed = new URL(finalUrl)
    if (parsed.protocol !== "https:" || !["vsdc.vn", "www.vsdc.vn"].includes(parsed.hostname.toLowerCase())) {
      throw new Error("VSDC corporate-action detail redirected off canonical host")
    }
    return response.text()
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", relayAbort)
  }
}

function isUnsupportedNonAdjustingEvent(error: unknown) {
  return error instanceof Error && error.message === "VSDC: no supported corporate-action component"
}

export async function fetchCorporateActionsForTicker(
  tickerInput: string,
  options: CorporateActionFetchOptions,
): Promise<CorporateActionFetchResult> {
  const ticker = normalizedTicker(tickerInput)
  if (!validIsoDate(options.asOf)) throw new Error("Invalid corporate-action asOf date")

  const fetchImpl = options.fetchImpl ?? fetch
  const discover = options.discover ?? discoverVsdcCorporateActionEvents
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_DELAY_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(requestDelayMs) || requestDelayMs < 0) throw new Error("Invalid corporate-action request delay")
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error("Invalid corporate-action timeout")

  const discovery = await discover(ticker, {
    fetchImpl,
    requestDelayMs,
    maxPages: options.maxPages,
  })
  if (discovery.ticker !== ticker) throw new Error("VSDC discovery ticker mismatch")

  const actions: NormalizedCorporateAction[] = []
  const notices: FetchedCorporateActionNotice[] = []
  const skipped: CorporateActionIngestionSkip[] = []

  for (const [index, sourceEventId] of discovery.eventIds.entries()) {
    if (index > 0) await delay(requestDelayMs)
    const sourceUrl = vsdcEventUrl(sourceEventId, "ad")
    const html = await fetchHtml(sourceUrl, fetchImpl, timeoutMs, options.signal)

    let notice: SourceCorporateActionNotice
    try {
      notice = parseVsdcCorporateActionHtml(html, sourceUrl)
    } catch (error) {
      if (isUnsupportedNonAdjustingEvent(error)) {
        skipped.push({ sourceEventId, reason: "unsupported_non_adjusting_event" })
        continue
      }
      throw error
    }

    if (notice.ticker !== ticker) throw new Error(`VSDC corporate-action ticker mismatch for event ${sourceEventId}`)

    const normalized = normalizeCorporateActionNotice(notice, {
      normalizationVersion: NORMALIZATION_VERSION,
      exDate: deriveVerifiedCorporateActionExDate(notice.recordDate),
    })
    if (normalized.rejected.length > 0 || normalized.actions.length !== notice.components.length) {
      throw new Error(`VSDC corporate-action normalization failed closed for event ${sourceEventId}`)
    }

    actions.push(...normalized.actions)
    notices.push({
      notice,
      rawPayload: { html },
      actions: normalized.actions,
    })
  }

  return { ticker, actions, notices, skipped }
}

export async function ingestCorporateActionsForTicker(
  supabase: SupabaseClient,
  tickerInput: string,
  options: CorporateActionFetchOptions,
) {
  const fetched = await fetchCorporateActionsForTicker(tickerInput, options)
  const persisted = []

  for (const batch of fetched.notices) {
    persisted.push(await persistCorporateActionNotice(supabase, {
      source: batch.notice.source,
      sourceEventId: batch.notice.sourceEventId,
      sourceUrl: batch.notice.sourceUrl,
      ticker: batch.notice.ticker,
      rawPayload: batch.rawPayload,
      rawEvidenceHash: batch.notice.rawEvidenceHash,
      sourcePublishedAt: batch.notice.sourcePublishedAt ?? null,
      sourceUpdatedAt: batch.notice.sourceUpdatedAt ?? null,
    }, batch.actions))
  }

  return { ...fetched, persisted }
}
