export type EodFailureClass = "ticker_local" | "recoverable_systemic" | "critical_systemic"
export type EodTickerAttemptStatus = "succeeded" | "failed"

export interface EodTickerAttempt {
  ticker: string
  stage: string
  status: EodTickerAttemptStatus
  errorClass: EodFailureClass | null
  attempt: number
  retryEligible: boolean
  error?: string
  errorCode?: string
}

export interface EodTickerCoverage {
  expectedCount: number
  healthyCount: number
  failedCount: number
  healthyTickers: string[]
  failedTickers: string[]
  complete: boolean
}

const STAGE_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  HISTORY_REFRESH: 10,
  WYCKOFF_BUILD: 20,
})

function normalizeTicker(value: string) {
  const ticker = String(value || "").trim().toUpperCase()
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) throw new Error(`Invalid EOD ticker: ${value}`)
  return ticker
}

function statusCode(error: unknown) {
  const direct = Number((error as { status?: unknown } | null)?.status)
  if (Number.isFinite(direct) && direct > 0) return direct
  const message = error instanceof Error ? error.message : String(error)
  const match = message.toUpperCase().match(/\bHTTP[_ ]?(\d{3})\b/)
  return match ? Number(match[1]) : 0
}

export function classifyEodFailure(
  error: unknown,
  context: { stage: string; ticker?: string },
): { errorClass: EodFailureClass; retryEligible: boolean } {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toUpperCase()
  const code = String((error as { code?: unknown } | null)?.code || "").toUpperCase()
  const httpStatus = statusCode(error)

  const critical = [
    "SUPABASE_VALIDATE_FAILED",
    "CANONICAL",
    "MEMBERSHIP MISMATCH",
    "SERVICE ROLE",
    "SERVICE_ROLE",
    "DATABASE",
    "POSTGRES",
    "SCHEMA CACHE",
    "OHLCV CACHE BATCH READ FAILED",
  ].some((token) => code.includes(token) || normalized.includes(token))
  if (critical) return { errorClass: "critical_systemic", retryEligible: false }

  if (context.ticker) {
    return { errorClass: "ticker_local", retryEligible: true }
  }

  const recoverable = httpStatus === 408
    || httpStatus === 425
    || httpStatus === 429
    || httpStatus >= 500
    || ["TIMEOUT", "TIMED OUT", "NETWORK", "CONNECTION", "ECONN", "FETCH FAILED", "RATE LIMIT", "RATE_LIMIT"]
      .some((token) => normalized.includes(token))
  if (recoverable) return { errorClass: "recoverable_systemic", retryEligible: true }

  return { errorClass: "critical_systemic", retryEligible: false }
}

function attemptRank(attempt: EodTickerAttempt) {
  return [STAGE_PRIORITY[attempt.stage] ?? 0, attempt.attempt] as const
}

function isLaterAttempt(candidate: EodTickerAttempt, current: EodTickerAttempt) {
  const [candidateStage, candidateAttempt] = attemptRank(candidate)
  const [currentStage, currentAttempt] = attemptRank(current)
  if (candidateStage !== currentStage) return candidateStage > currentStage
  return candidateAttempt > currentAttempt
}

export function latestTickerAttempts(attempts: readonly EodTickerAttempt[]) {
  const latest = new Map<string, EodTickerAttempt>()
  for (const raw of attempts) {
    const attempt: EodTickerAttempt = { ...raw, ticker: normalizeTicker(raw.ticker) }
    const current = latest.get(attempt.ticker)
    if (!current || isLaterAttempt(attempt, current)) latest.set(attempt.ticker, attempt)
  }
  return latest
}

export function appendTickerAttempts(
  previous: readonly EodTickerAttempt[],
  current: readonly EodTickerAttempt[],
): EodTickerAttempt[] {
  return [...previous, ...current].map((attempt) => ({ ...attempt, ticker: normalizeTicker(attempt.ticker) }))
}

export function computeEodTickerCoverage(
  canonicalTickers: readonly string[],
  attempts: readonly EodTickerAttempt[],
): EodTickerCoverage {
  const canonical = [...new Set(canonicalTickers.map(normalizeTicker))].sort()
  const latest = latestTickerAttempts(attempts)
  const healthyTickers: string[] = []
  const failedTickers: string[] = []

  for (const ticker of canonical) {
    const attempt = latest.get(ticker)
    if (attempt?.status === "succeeded") healthyTickers.push(ticker)
    else failedTickers.push(ticker)
  }

  return {
    expectedCount: canonical.length,
    healthyCount: healthyTickers.length,
    failedCount: failedTickers.length,
    healthyTickers,
    failedTickers,
    complete: canonical.length > 0 && failedTickers.length === 0,
  }
}

export function selectRetryTickers(
  attempts: readonly EodTickerAttempt[],
  requestedTickers?: readonly string[],
) {
  const latest = latestTickerAttempts(attempts)
  const eligible = [...latest.values()]
    .filter((attempt) => attempt.status === "failed" && attempt.retryEligible)
    .map((attempt) => attempt.ticker)
    .sort()
  const eligibleSet = new Set(eligible)

  if (requestedTickers == null) return eligible
  const requested = [...new Set(requestedTickers.map(normalizeTicker))].sort()
  for (const ticker of requested) {
    if (!eligibleSet.has(ticker)) throw new Error(`Ticker ${ticker} is not retry-eligible for this EOD run`)
  }
  return requested
}
