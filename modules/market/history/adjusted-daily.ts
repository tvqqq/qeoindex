const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TICKER = /^[A-Z0-9]{2,12}$/
const LINEAGE_HASH = /^[a-f0-9]{64}$/

export type ShadowFactorRunStatus = "candidate" | "active" | "blocked" | "superseded"

export type ShadowFactorRun = {
  id: string
  ticker: string
  factorVersion: string
  engineVersion: string
  eventLineageHash: string
  status: ShadowFactorRunStatus
}

export type ShadowFactorTransition = {
  effectiveSession: string
  cumulativePriceFactor: number
  cumulativeVolumeFactor: number
}

export type RawDailyBar = {
  ticker: string
  sessionDate: string
  barTime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type AdjustedDailyBar = {
  ticker: string
  sessionDate: string
  barTime: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  rawBarTime: string
  factorRunId: string
  factorVersion: string
  eventLineageHash: string
  adjustmentEngineVersion: string
}

export type AdjustedDailyErrorCode =
  | "INVALID_SESSION_DATE"
  | "INVALID_FACTOR_TRANSITION"
  | "INVALID_FACTOR_RUN"
  | "INVALID_RAW_DAILY"
  | "TICKER_MISMATCH"
  | "INVALID_ADJUSTED_DAILY"

export class AdjustedDailyError extends Error {
  readonly code: AdjustedDailyErrorCode

  constructor(code: AdjustedDailyErrorCode, message: string) {
    super(message)
    this.name = "AdjustedDailyError"
    this.code = code
  }
}

function validIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0
}

function nonNegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0
}

function validateTransitionSequence(transitions: readonly ShadowFactorTransition[]) {
  let previous: string | null = null
  for (const transition of transitions) {
    if (
      !validIsoDate(transition.effectiveSession)
      || !positiveFinite(transition.cumulativePriceFactor)
      || !positiveFinite(transition.cumulativeVolumeFactor)
    ) {
      throw new AdjustedDailyError("INVALID_FACTOR_TRANSITION", "QEO-129 factor transition is invalid")
    }
    if (previous !== null && transition.effectiveSession <= previous) {
      throw new AdjustedDailyError(
        "INVALID_FACTOR_TRANSITION",
        "QEO-129 factor transitions must be strictly increasing by effective session",
      )
    }
    previous = transition.effectiveSession
  }
}

function validateRun(run: ShadowFactorRun) {
  if (
    !run.id
    || !TICKER.test(run.ticker)
    || !run.factorVersion.trim()
    || !run.engineVersion.trim()
    || !LINEAGE_HASH.test(run.eventLineageHash)
  ) {
    throw new AdjustedDailyError("INVALID_FACTOR_RUN", "QEO-129 factor run identity is invalid")
  }
  if (run.status !== "candidate" && run.status !== "active") {
    throw new AdjustedDailyError("INVALID_FACTOR_RUN", `QEO-129 factor run status ${run.status} is not consumable`)
  }
}

function validateRaw(raw: RawDailyBar) {
  const parsedBarTime = Date.parse(raw.barTime)
  if (
    !TICKER.test(raw.ticker)
    || !validIsoDate(raw.sessionDate)
    || !Number.isFinite(parsedBarTime)
    || !positiveFinite(raw.open)
    || !positiveFinite(raw.high)
    || !positiveFinite(raw.low)
    || !positiveFinite(raw.close)
    || !nonNegativeFinite(raw.volume)
    || raw.high < Math.max(raw.open, raw.close, raw.low)
    || raw.low > Math.min(raw.open, raw.close, raw.high)
  ) {
    throw new AdjustedDailyError("INVALID_RAW_DAILY", "QEO-129 raw Daily OHLCV is invalid")
  }
}

export function factorForSession(
  sessionDate: string,
  transitions: readonly ShadowFactorTransition[],
): { priceFactor: number; volumeFactor: number } {
  if (!validIsoDate(sessionDate)) {
    throw new AdjustedDailyError("INVALID_SESSION_DATE", "QEO-129 session date is invalid")
  }
  validateTransitionSequence(transitions)

  const next = transitions.find((transition) => transition.effectiveSession > sessionDate)
  return next
    ? {
        priceFactor: next.cumulativePriceFactor,
        volumeFactor: next.cumulativeVolumeFactor,
      }
    : { priceFactor: 1, volumeFactor: 1 }
}

export function applyDailyAdjustment(input: {
  raw: RawDailyBar
  run: ShadowFactorRun
  transitions: readonly ShadowFactorTransition[]
}): AdjustedDailyBar {
  validateRun(input.run)
  validateRaw(input.raw)
  if (input.raw.ticker !== input.run.ticker) {
    throw new AdjustedDailyError("TICKER_MISMATCH", "QEO-129 raw Daily ticker does not match factor run ticker")
  }

  const { priceFactor, volumeFactor } = factorForSession(input.raw.sessionDate, input.transitions)
  const adjusted: AdjustedDailyBar = {
    ticker: input.raw.ticker,
    sessionDate: input.raw.sessionDate,
    barTime: input.raw.barTime,
    open: input.raw.open * priceFactor,
    high: input.raw.high * priceFactor,
    low: input.raw.low * priceFactor,
    close: input.raw.close * priceFactor,
    volume: input.raw.volume * volumeFactor,
    rawBarTime: input.raw.barTime,
    factorRunId: input.run.id,
    factorVersion: input.run.factorVersion,
    eventLineageHash: input.run.eventLineageHash,
    adjustmentEngineVersion: input.run.engineVersion,
  }

  if (
    !positiveFinite(adjusted.open)
    || !positiveFinite(adjusted.high)
    || !positiveFinite(adjusted.low)
    || !positiveFinite(adjusted.close)
    || !nonNegativeFinite(adjusted.volume)
    || adjusted.high < Math.max(adjusted.open, adjusted.close, adjusted.low)
    || adjusted.low > Math.min(adjusted.open, adjusted.close, adjusted.high)
  ) {
    throw new AdjustedDailyError("INVALID_ADJUSTED_DAILY", "QEO-129 adjusted Daily OHLCV is invalid")
  }

  return adjusted
}
