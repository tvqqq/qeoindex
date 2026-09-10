export type FuturesBasisState = "premium" | "discount" | "neutral" | "unknown"
export type FuturesBasisStatus = "ready" | "degraded"

export interface FuturesBasisSessionPoint {
  sessionDate: string
  value: number | null
}

export interface FuturesBasisPulse {
  status: FuturesBasisStatus
  sessionDate: string
  futuresLast: number | null
  spotValue: number | null
  basis: number | null
  basisPct: number | null
  state: FuturesBasisState
  previousSessionDate: string | null
  previousBasis: number | null
  basisChange: number | null
  basisChangeMessage: string
  openInterest: number | null
  openInterestChange: number | null
  openInterestStatus: "unverified_source"
  openInterestMessage: string
  message: string
  futuresSource: string
  spotSource: string
}

export interface BuildFuturesBasisPulseInput {
  targetSessionDate: string
  futuresSessions: FuturesBasisSessionPoint[]
  spotSessions: FuturesBasisSessionPoint[]
  futuresSource?: string
  spotSource?: string
}

const NEUTRAL_BASIS_PCT = 0.05
const DEFAULT_FUTURES_SOURCE = "DNSE VN30F1M · EOD 1D"
const DEFAULT_SPOT_SOURCE = "Market Insights VN30 · EOD"

function validValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0
}

function exactSession(
  sessions: FuturesBasisSessionPoint[],
  sessionDate: string,
): FuturesBasisSessionPoint | null {
  return sessions.find((item) => item.sessionDate === sessionDate) ?? null
}

function priorSpotSession(
  sessions: FuturesBasisSessionPoint[],
  targetSessionDate: string,
): FuturesBasisSessionPoint | null {
  return [...sessions]
    .filter((item) => item.sessionDate < targetSessionDate)
    .sort((left, right) => right.sessionDate.localeCompare(left.sessionDate))[0] ?? null
}

export function classifyFuturesBasisState(basisPct: number | null): FuturesBasisState {
  if (basisPct == null || !Number.isFinite(basisPct)) return "unknown"
  if (basisPct > NEUTRAL_BASIS_PCT) return "premium"
  if (basisPct < -NEUTRAL_BASIS_PCT) return "discount"
  return "neutral"
}

export function buildFuturesBasisPulse(input: BuildFuturesBasisPulseInput): FuturesBasisPulse {
  const targetSessionDate = input.targetSessionDate
  const currentFuture = exactSession(input.futuresSessions, targetSessionDate)
  const currentSpot = exactSession(input.spotSessions, targetSessionDate)
  const futuresSource = input.futuresSource ?? DEFAULT_FUTURES_SOURCE
  const spotSource = input.spotSource ?? DEFAULT_SPOT_SOURCE
  const base = {
    sessionDate: targetSessionDate,
    openInterest: null,
    openInterestChange: null,
    openInterestStatus: "unverified_source" as const,
    openInterestMessage: "Nguồn OI tự động chưa được xác minh.",
    futuresSource,
    spotSource,
  }

  if (!currentFuture || !validValue(currentFuture.value)) {
    return {
      ...base,
      status: "degraded",
      futuresLast: null,
      spotValue: validValue(currentSpot?.value) ? currentSpot.value : null,
      basis: null,
      basisPct: null,
      state: "unknown",
      previousSessionDate: null,
      previousBasis: null,
      basisChange: null,
      basisChangeMessage: "Chưa đủ dữ liệu phiên trước để tính Δ basis.",
      message: `Chưa có F1M cùng phiên ${targetSessionDate}; không tính basis từ dữ liệu lệch phiên.`,
    }
  }

  if (!currentSpot || !validValue(currentSpot.value)) {
    return {
      ...base,
      status: "degraded",
      futuresLast: currentFuture.value,
      spotValue: null,
      basis: null,
      basisPct: null,
      state: "unknown",
      previousSessionDate: null,
      previousBasis: null,
      basisChange: null,
      basisChangeMessage: "Chưa đủ dữ liệu phiên trước để tính Δ basis.",
      message: `Chưa có VN30 spot cùng phiên ${targetSessionDate}; không tính basis từ dữ liệu lệch phiên.`,
    }
  }

  const basis = currentFuture.value - currentSpot.value
  const basisPct = (basis / currentSpot.value) * 100
  const previousSpot = priorSpotSession(input.spotSessions, targetSessionDate)
  const previousFuture = previousSpot ? exactSession(input.futuresSessions, previousSpot.sessionDate) : null
  const previousSessionDate = previousSpot?.sessionDate ?? null
  const previousBasis = previousSpot && previousFuture && validValue(previousSpot.value) && validValue(previousFuture.value)
    ? previousFuture.value - previousSpot.value
    : null
  const basisChange = previousBasis == null ? null : basis - previousBasis

  return {
    ...base,
    status: "ready",
    futuresLast: currentFuture.value,
    spotValue: currentSpot.value,
    basis,
    basisPct,
    state: classifyFuturesBasisState(basisPct),
    previousSessionDate,
    previousBasis,
    basisChange,
    basisChangeMessage: basisChange == null
      ? "Chưa đủ dữ liệu phiên trước để tính Δ basis."
      : `So với phiên trước ${previousSessionDate}.`,
    message: `VN30F1M và VN30 spot đã căn cùng phiên ${targetSessionDate}.`,
  }
}
