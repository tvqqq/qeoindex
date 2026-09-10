export type InstitutionalFlowKey = "foreign" | "proprietary" | "other"

export type InstitutionalFlowPersistenceState =
  | "persistent_buying"
  | "persistent_selling"
  | "reversal_to_buying"
  | "reversal_to_selling"
  | "unknown"

export interface InstitutionalFlowHistoryPoint {
  sessionDate: string
  foreignNetValue: number | null
  proprietaryNetValue: number | null
  otherFlowNetValue: number | null
}

export interface InstitutionalFlowPersistenceRow {
  key: InstitutionalFlowKey
  label: string
  today: number | null
  fiveDay: number | null
  twentyDay: number | null
  state: InstitutionalFlowPersistenceState
}

export interface InstitutionalFlowPersistenceContext {
  sessionDate: string
  sessionCount: number
  rows: InstitutionalFlowPersistenceRow[]
}

type FlowField = "foreignNetValue" | "proprietaryNetValue" | "otherFlowNetValue"

const FLOW_DEFINITIONS: ReadonlyArray<{ key: InstitutionalFlowKey; label: string; field: FlowField }> = [
  { key: "foreign", label: "Khối ngoại", field: "foreignNetValue" },
  { key: "proprietary", label: "Tự doanh", field: "proprietaryNetValue" },
  { key: "other", label: "Khác", field: "otherFlowNetValue" },
]

function finite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

function round6(value: number) {
  return Number(value.toFixed(6))
}

function sumExactWindow(
  sessions: readonly InstitutionalFlowHistoryPoint[],
  field: FlowField,
  size: number,
): number | null {
  if (sessions.length < size) return null
  const window = sessions.slice(-size)
  const values = window.map((point) => point[field])
  if (values.some((value) => !finite(value))) return null
  return round6((values as number[]).reduce((sum, value) => sum + value, 0))
}

function deriveState(
  fiveDay: number | null,
  twentyDay: number | null,
): InstitutionalFlowPersistenceState {
  if (!finite(fiveDay) || !finite(twentyDay) || fiveDay === 0 || twentyDay === 0) return "unknown"
  if (fiveDay > 0 && twentyDay < 0) return "reversal_to_buying"
  if (fiveDay < 0 && twentyDay > 0) return "reversal_to_selling"
  if (fiveDay > 0 && twentyDay > 0) return "persistent_buying"
  if (fiveDay < 0 && twentyDay < 0) return "persistent_selling"
  return "unknown"
}

export function buildInstitutionalFlowPersistence({
  sessionDate,
  history,
}: {
  sessionDate: string
  history: readonly InstitutionalFlowHistoryPoint[]
}): InstitutionalFlowPersistenceContext {
  const bySession = new Map<string, InstitutionalFlowHistoryPoint>()
  for (const point of history) {
    if (!point?.sessionDate || point.sessionDate > sessionDate) continue
    bySession.set(point.sessionDate, point)
  }

  const sessions = [...bySession.values()]
    .sort((left, right) => left.sessionDate.localeCompare(right.sessionDate))
    .slice(-20)
  const current = sessions.find((point) => point.sessionDate === sessionDate) ?? null

  const rows = FLOW_DEFINITIONS.map(({ key, label, field }) => {
    if (!current) {
      return { key, label, today: null, fiveDay: null, twentyDay: null, state: "unknown" as const }
    }

    const currentValue = current[field]
    const today = finite(currentValue) ? currentValue : null
    const fiveDay = sumExactWindow(sessions, field, 5)
    const twentyDay = sumExactWindow(sessions, field, 20)

    return {
      key,
      label,
      today,
      fiveDay,
      twentyDay,
      state: deriveState(fiveDay, twentyDay),
    }
  })

  return {
    sessionDate,
    sessionCount: current ? sessions.length : 0,
    rows,
  }
}
