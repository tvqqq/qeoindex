export type BreadthDivergenceState =
  | "confirmation"
  | "bearish_divergence"
  | "recovery_divergence"
  | "neutral"
  | "unknown"

export interface BreadthDivergencePoint {
  sessionDate: string
  vnindexClose: number | null
  aboveMa20Pct: number | null
  aboveMa50Pct: number | null
}

export interface BreadthDivergenceContext {
  state: BreadthDivergenceState
  windowSessions: number
  pairedSessions: number
  startDate: string | null
  endDate: string | null
  vnindexChangePct: number | null
  ma50ChangePp: number | null
  ma20ChangePp: number | null
  points: BreadthDivergencePoint[]
}

interface BreadthDivergenceInput {
  sessionDate: string
  history?: Array<{
    sessionDate: string
    vnindexClose?: number | null
    aboveMa20Pct?: number | null
    aboveMa50Pct?: number | null
  }>
}

const WINDOW_SESSIONS = 10
const MIN_PAIRED_SESSIONS = 8
const INDEX_MOVE_THRESHOLD_PCT = 1
const BREADTH_MOVE_THRESHOLD_PP = 5

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function rounded(value: number, decimals = 6): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function normalizePoint(point: NonNullable<BreadthDivergenceInput["history"]>[number]): BreadthDivergencePoint {
  return {
    sessionDate: point.sessionDate,
    vnindexClose: finite(point.vnindexClose),
    aboveMa20Pct: finite(point.aboveMa20Pct),
    aboveMa50Pct: finite(point.aboveMa50Pct),
  }
}

export function buildBreadthDivergenceContext(input: BreadthDivergenceInput): BreadthDivergenceContext {
  const points = [...(input.history ?? [])]
    .filter((point) => point.sessionDate <= input.sessionDate)
    .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
    .slice(-WINDOW_SESSIONS)
    .map(normalizePoint)

  const paired = points.filter((point) => point.vnindexClose != null && point.aboveMa50Pct != null)
  const empty = {
    windowSessions: points.length,
    pairedSessions: paired.length,
    startDate: null,
    endDate: null,
    vnindexChangePct: null,
    ma50ChangePp: null,
    ma20ChangePp: null,
    points,
  }

  if (paired.length < MIN_PAIRED_SESSIONS) {
    return { state: "unknown", ...empty }
  }

  const first = paired[0]
  const last = paired[paired.length - 1]
  if (first.vnindexClose == null || last.vnindexClose == null || first.aboveMa50Pct == null || last.aboveMa50Pct == null || first.vnindexClose === 0) {
    return { state: "unknown", ...empty }
  }

  const vnindexChangePct = rounded(((last.vnindexClose - first.vnindexClose) / Math.abs(first.vnindexClose)) * 100)
  const ma50ChangePp = rounded(last.aboveMa50Pct - first.aboveMa50Pct)
  const ma20Points = points.filter((point) => point.aboveMa20Pct != null)
  const ma20ChangePp = ma20Points.length >= 2
    ? rounded((ma20Points[ma20Points.length - 1].aboveMa20Pct ?? 0) - (ma20Points[0].aboveMa20Pct ?? 0))
    : null

  let state: BreadthDivergenceState = "neutral"
  if (vnindexChangePct >= INDEX_MOVE_THRESHOLD_PCT && ma50ChangePp <= -BREADTH_MOVE_THRESHOLD_PP) {
    state = "bearish_divergence"
  } else if (vnindexChangePct <= -INDEX_MOVE_THRESHOLD_PCT && ma50ChangePp >= BREADTH_MOVE_THRESHOLD_PP) {
    state = "recovery_divergence"
  } else if (
    (vnindexChangePct >= INDEX_MOVE_THRESHOLD_PCT && ma50ChangePp >= BREADTH_MOVE_THRESHOLD_PP) ||
    (vnindexChangePct <= -INDEX_MOVE_THRESHOLD_PCT && ma50ChangePp <= -BREADTH_MOVE_THRESHOLD_PP)
  ) {
    state = "confirmation"
  }

  return {
    state,
    windowSessions: points.length,
    pairedSessions: paired.length,
    startDate: first.sessionDate,
    endDate: last.sessionDate,
    vnindexChangePct,
    ma50ChangePp,
    ma20ChangePp,
    points,
  }
}
