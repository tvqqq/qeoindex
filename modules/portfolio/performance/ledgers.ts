import type { EquityPoint } from "../risk-engine/types.ts"
import type {
  AccountLedgerPeriod,
  ClosedTradeOutcome,
  PerformancePopulation,
  PeriodLedgerSet,
  TradingLedgerPeriod,
} from "./types.ts"

const VN_TIME_ZONE = "Asia/Ho_Chi_Minh"
const VN_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: VN_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

type PeriodKind = "daily" | "weekly" | "monthly" | "annual"

type DatedEquityPoint = {
  point: EquityPoint
  index: number
  date: string
}

function mean(values: readonly number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null
}

function vnDateFromInstant(timestamp: string): string {
  const parts = VN_DATE_FORMATTER.formatToParts(new Date(timestamp))
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  const day = parts.find((part) => part.type === "day")?.value
  if (!year || !month || !day) throw new TypeError(`Invalid timestamp: ${timestamp}`)
  return `${year}-${month}-${day}`
}

function mondayKey(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  const utc = new Date(Date.UTC(year!, month! - 1, day!))
  const delta = (utc.getUTCDay() + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - delta)
  return utc.toISOString().slice(0, 10)
}

function periodKey(date: string, kind: PeriodKind): string {
  if (kind === "daily") return date
  if (kind === "weekly") return mondayKey(date)
  if (kind === "monthly") return date.slice(0, 7)
  return date.slice(0, 4)
}

function selectPopulation(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): ClosedTradeOutcome[] {
  return (population === "combined"
    ? [...outcomes]
    : outcomes.filter((row) => row.mode === population))
    .sort((a, b) => {
      const timeDiff = new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
      return timeDiff !== 0 ? timeDiff : a.tradeId.localeCompare(b.tradeId)
    })
}

function summarizeTradingPeriods(
  outcomes: readonly ClosedTradeOutcome[],
  kind: PeriodKind,
): TradingLedgerPeriod[] {
  const groups = new Map<string, ClosedTradeOutcome[]>()
  for (const row of outcomes) {
    const key = periodKey(vnDateFromInstant(row.closedAt), kind)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  let runningNetPnlVnd = 0
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const winners = rows.filter((row) => row.netPnlVnd > 0)
      const losers = rows.filter((row) => row.netPnlVnd < 0)
      const netPnlVnd = rows.reduce((sum, row) => sum + row.netPnlVnd, 0)
      runningNetPnlVnd += netPnlVnd

      return {
        key,
        tradeCount: rows.length,
        winnerCount: winners.length,
        loserCount: losers.length,
        breakevenCount: rows.length - winners.length - losers.length,
        grossProfitVnd: rows
          .filter((row) => row.grossPnlVnd > 0)
          .reduce((sum, row) => sum + row.grossPnlVnd, 0),
        grossLossVnd: rows
          .filter((row) => row.grossPnlVnd < 0)
          .reduce((sum, row) => sum + row.grossPnlVnd, 0),
        commissionVnd: rows.reduce((sum, row) => sum + row.totalFeesVnd, 0),
        netPnlVnd,
        runningNetPnlVnd,
        averageWinVnd: mean(winners.map((row) => row.netPnlVnd)),
        averageLossVnd: mean(losers.map((row) => row.netPnlVnd)),
        largestWinVnd: winners.length > 0
          ? Math.max(...winners.map((row) => row.netPnlVnd))
          : null,
        largestLossVnd: losers.length > 0
          ? Math.min(...losers.map((row) => row.netPnlVnd))
          : null,
      }
    })
}

export function buildTradingLedgers(
  outcomes: readonly ClosedTradeOutcome[],
  population: PerformancePopulation,
): PeriodLedgerSet {
  const selected = selectPopulation(outcomes, population)
  return {
    daily: summarizeTradingPeriods(selected, "daily"),
    weekly: summarizeTradingPeriods(selected, "weekly"),
    monthly: summarizeTradingPeriods(selected, "monthly"),
    annual: summarizeTradingPeriods(selected, "annual"),
  }
}

function dateFromEquityKey(point: EquityPoint): string | null {
  if (point.kind === "baseline") return null
  const date = point.key.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function orderedEquityPoints(points: readonly EquityPoint[]): EquityPoint[] {
  return [...points].sort((a, b) => {
    if (a.kind === "baseline" && b.kind !== "baseline") return -1
    if (b.kind === "baseline" && a.kind !== "baseline") return 1
    const aDate = dateFromEquityKey(a) ?? ""
    const bDate = dateFromEquityKey(b) ?? ""
    const dateDiff = aDate.localeCompare(bDate)
    if (dateDiff !== 0) return dateDiff
    const rank = (kind: EquityPoint["kind"]) => kind === "daily" ? 0 : kind === "current" ? 1 : -1
    return rank(a.kind) - rank(b.kind)
  })
}

function completeEquity(point: EquityPoint): point is EquityPoint & { equityVnd: number } {
  return point.status === "complete"
    && point.equityVnd != null
    && Number.isFinite(point.equityVnd)
}

function accountPeriodsForKind(
  points: readonly EquityPoint[],
  kind: PeriodKind,
): AccountLedgerPeriod[] {
  const ordered = orderedEquityPoints(points)
  const dated: DatedEquityPoint[] = []
  ordered.forEach((point, index) => {
    const date = dateFromEquityKey(point)
    if (date) dated.push({ point, index, date })
  })

  const groups = new Map<string, DatedEquityPoint[]>()
  for (const row of dated) {
    const key = periodKey(row.date, kind)
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const firstIndex = rows[0]!.index
      const end = rows.at(-1)!

      let anchorIndex = -1
      for (let index = firstIndex - 1; index >= 0; index -= 1) {
        if (completeEquity(ordered[index]!)) {
          anchorIndex = index
          break
        }
      }

      const allHistoryThroughEndComplete = anchorIndex >= 0
        && ordered.slice(0, end.index + 1).every(completeEquity)
      const anchor = anchorIndex >= 0 ? ordered[anchorIndex]! : null
      const endPoint = end.point

      if (
        !allHistoryThroughEndComplete
        || anchor == null
        || !completeEquity(anchor)
        || !completeEquity(endPoint)
        || !(anchor.equityVnd > 0)
      ) {
        return {
          key,
          startEquityVnd: anchor != null && completeEquity(anchor) ? anchor.equityVnd : null,
          endEquityVnd: completeEquity(endPoint) ? endPoint.equityVnd : null,
          returnPercent: null,
          worstDrawdownPercent: null,
          completeness: "insufficient" as const,
        }
      }

      let runningPeak = Number.NEGATIVE_INFINITY
      let worstDrawdownPercent = 0
      const periodIndexes = new Set(rows.map((row) => row.index))
      for (let index = 0; index <= end.index; index += 1) {
        const point = ordered[index]!
        const equityVnd = point.equityVnd!
        runningPeak = Math.max(runningPeak, equityVnd)
        if (periodIndexes.has(index) && runningPeak > 0) {
          worstDrawdownPercent = Math.max(
            worstDrawdownPercent,
            ((runningPeak - equityVnd) / runningPeak) * 100,
          )
        }
      }

      return {
        key,
        startEquityVnd: anchor.equityVnd,
        endEquityVnd: endPoint.equityVnd,
        returnPercent: ((endPoint.equityVnd - anchor.equityVnd) / anchor.equityVnd) * 100,
        worstDrawdownPercent,
        completeness: "complete" as const,
      }
    })
}

export function buildAccountLedgers(points: readonly EquityPoint[]): {
  daily: AccountLedgerPeriod[]
  weekly: AccountLedgerPeriod[]
  monthly: AccountLedgerPeriod[]
  annual: AccountLedgerPeriod[]
} {
  return {
    daily: accountPeriodsForKind(points, "daily"),
    weekly: accountPeriodsForKind(points, "weekly"),
    monthly: accountPeriodsForKind(points, "monthly"),
    annual: accountPeriodsForKind(points, "annual"),
  }
}
