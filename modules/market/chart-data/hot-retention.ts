import type { SupabaseClient } from "@supabase/supabase-js"
import { isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar.ts"
import { CHART_HOT_RETENTION_SESSIONS } from "./history-policy.ts"

/**
 * Supabase/PostgREST commonly caps an unbounded response at 1,000 rows. Keep
 * this proof deliberately paged and bounded so a malformed or unexpectedly
 * dense ticker cannot make archive discovery unbounded.
 */
export const CHART_HOT_RETENTION_PROOF_PAGE_SIZE = 500
export const CHART_HOT_RETENTION_PROOF_MAX_PAGES = 20

export type HotArchiveRetentionProofReason =
  | "eligible"
  | "invalid_candidate"
  | "query_error"
  | "malformed_bar_time"
  | "fewer_newer_trading_sessions"
  | "proof_page_cap_reached"

export interface HotArchiveRetentionProof {
  eligible: boolean
  reason: HotArchiveRetentionProofReason
  requiredSessions: number
  newerTradingDates: string[]
  rowsScanned: number
  pagesRead: number
  error?: string
}

export interface HotRetentionCandidate {
  ticker: string
  tradingDate: string
  toExclusive: number
}

export function hotRetentionCandidateKey(candidate: HotRetentionCandidate) {
  return `${candidate.ticker}:${candidate.tradingDate}`
}

function proofResult(
  reason: HotArchiveRetentionProofReason,
  input: {
    newerTradingDates?: Iterable<string>
    rowsScanned?: number
    pagesRead?: number
    error?: string
  } = {},
): HotArchiveRetentionProof {
  const newerTradingDates = [...(input.newerTradingDates ?? [])]
  return {
    eligible: reason === "eligible",
    reason,
    requiredSessions: CHART_HOT_RETENTION_SESSIONS,
    newerTradingDates,
    rowsScanned: input.rowsScanned ?? 0,
    pagesRead: input.pagesRead ?? 0,
    ...(input.error ? { error: input.error } : {}),
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return String(error.message)
  return String(error)
}

function parseBarTime(value: unknown) {
  if (typeof value !== "string" && !(value instanceof Date) && typeof value !== "number") return null
  const timestamp = typeof value === "number"
    ? Math.abs(value) < 1e12 ? value * 1000 : value
    : value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null
}

/**
 * Prove that a candidate ticker/session is at least sixth-oldest in that
 * ticker's own HOT history. The global archive cutoff remains discovery-only;
 * this per-ticker proof is the final archive/prune eligibility authority.
 */
export async function proveHotArchivePartitionEligibility(
  supabase: SupabaseClient,
  input: { ticker: string; toExclusive: number },
): Promise<HotArchiveRetentionProof> {
  const ticker = input.ticker.trim().toUpperCase()
  if (!ticker || !Number.isSafeInteger(input.toExclusive) || input.toExclusive <= 0) {
    return proofResult("invalid_candidate")
  }

  const newerTradingDates = new Set<string>()
  let rowsScanned = 0
  let pagesRead = 0

  for (let offset = 0; offset < CHART_HOT_RETENTION_PROOF_PAGE_SIZE * CHART_HOT_RETENTION_PROOF_MAX_PAGES; offset += CHART_HOT_RETENTION_PROOF_PAGE_SIZE) {
    let result: { data: unknown; error: { message?: string | null } | null }
    try {
      result = await supabase
        .from("chart_ohlcv_intraday")
        .select("bar_time")
        .eq("ticker", ticker)
        .eq("base_resolution", "1m")
        .gt("bar_time", new Date(input.toExclusive * 1000).toISOString())
        .order("bar_time", { ascending: false })
        .range(offset, offset + CHART_HOT_RETENTION_PROOF_PAGE_SIZE - 1)
    } catch (error) {
      return proofResult("query_error", {
        newerTradingDates,
        rowsScanned,
        pagesRead,
        error: errorMessage(error),
      })
    }

    pagesRead += 1
    if (result.error) {
      return proofResult("query_error", {
        newerTradingDates,
        rowsScanned,
        pagesRead,
        error: result.error.message ?? "unknown hot-store retention proof query error",
      })
    }

    const page = Array.isArray(result.data) ? result.data : []
    for (const raw of page) {
      rowsScanned += 1
      const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
      const epochSeconds = parseBarTime(row.bar_time)
      if (epochSeconds == null) {
        return proofResult("malformed_bar_time", {
          newerTradingDates,
          rowsScanned,
          pagesRead,
          error: "Hot retention proof encountered a malformed bar_time",
        })
      }
      // Keep the proof strict even if a provider/query plan returns a row on
      // the boundary despite the PostgREST gt() predicate.
      if (epochSeconds <= input.toExclusive) continue
      const tradingDate = vietnamDateKey(epochSeconds * 1000)
      if (!isVietnamSecuritiesTradingDateKey(tradingDate)) continue
      newerTradingDates.add(tradingDate)
      if (newerTradingDates.size >= CHART_HOT_RETENTION_SESSIONS) {
        return proofResult("eligible", {
          newerTradingDates,
          rowsScanned,
          pagesRead,
        })
      }
    }

    if (page.length < CHART_HOT_RETENTION_PROOF_PAGE_SIZE) {
      return proofResult("fewer_newer_trading_sessions", {
        newerTradingDates,
        rowsScanned,
        pagesRead,
      })
    }
  }

  return proofResult("proof_page_cap_reached", {
    newerTradingDates,
    rowsScanned,
    pagesRead,
    error: `Hot retention proof reached its ${CHART_HOT_RETENTION_PROOF_MAX_PAGES}-page cap before proving five newer trading sessions`,
  })
}

/**
 * Prove every discovered candidate with one bounded HOT scan per ticker. The
 * discovered candidate date is itself existing HOT evidence, so it may extend
 * the newer-session set only after that candidate has been evaluated.
 */
export async function proveHotArchivePartitionsEligibility(
  supabase: SupabaseClient,
  candidates: HotRetentionCandidate[],
) {
  const byTicker = new Map<string, HotRetentionCandidate[]>()
  for (const candidate of candidates) {
    const group = byTicker.get(candidate.ticker) ?? []
    group.push(candidate)
    byTicker.set(candidate.ticker, group)
  }

  const proofs = new Map<string, HotArchiveRetentionProof>()
  for (const [ticker, tickerCandidates] of byTicker) {
    const newestFirst = [...tickerCandidates].sort((left, right) => right.toExclusive - left.toExclusive)
    const seed = await proveHotArchivePartitionEligibility(supabase, {
      ticker,
      toExclusive: newestFirst[0].toExclusive,
    })

    if (seed.reason !== "eligible" && seed.reason !== "fewer_newer_trading_sessions") {
      for (const candidate of newestFirst) proofs.set(hotRetentionCandidateKey(candidate), seed)
      continue
    }

    const newerTradingDates = new Set(seed.newerTradingDates)
    for (const candidate of newestFirst) {
      const eligible = newerTradingDates.size >= CHART_HOT_RETENTION_SESSIONS
      proofs.set(hotRetentionCandidateKey(candidate), {
        ...seed,
        eligible,
        reason: eligible ? "eligible" : "fewer_newer_trading_sessions",
        newerTradingDates: [...newerTradingDates],
      })
      if (isVietnamSecuritiesTradingDateKey(candidate.tradingDate)) {
        newerTradingDates.add(candidate.tradingDate)
      }
    }
  }
  return proofs
}
