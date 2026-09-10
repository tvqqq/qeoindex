export interface DistributionHistoryPoint {
  sessionDate: string
  distributionCount: number | null
  distributionWindow: string | null
  totalMatchedVolume: number | null
  vnindexChangePct: number | null
}

export interface DistributionTimelineSession extends DistributionHistoryPoint {
  isDistributionDay: boolean
  isExpiry: boolean
  volumeChangePct: number | null
}

export interface DistributionDayTimelineContext {
  sessions: DistributionTimelineSession[]
  currentDistributionCount: number | null
  currentDistributionWindow: string | null
  verifiedMarks10: number
  verifiedMarks25: number
  expiryCount25: number
  latestMarkSessionsAgo: number | null
  unverifiedTransitionCount25: number
}

function canonicalCount(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null
  return value
}

function positiveFinite(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return value
}

export function buildDistributionDayTimeline(input: {
  sessionDate: string
  currentDistributionCount: number | null | undefined
  currentDistributionWindow?: string | null
  history: DistributionHistoryPoint[]
}): DistributionDayTimelineContext {
  const ordered = input.history
    .filter((item) => item.sessionDate && item.sessionDate <= input.sessionDate)
    .slice()
    .sort((a, b) => a.sessionDate.localeCompare(b.sessionDate))
    .slice(-25)

  let unverifiedTransitionCount25 = 0
  const sessions: DistributionTimelineSession[] = ordered.map((item, index) => {
    const count = canonicalCount(item.distributionCount)
    const previousCount = index > 0 ? canonicalCount(ordered[index - 1]?.distributionCount) : null
    const volume = positiveFinite(item.totalMatchedVolume)
    const previousVolume = index > 0 ? positiveFinite(ordered[index - 1]?.totalMatchedVolume) : null
    const hasVerifiedTransition = index > 0 && count != null && previousCount != null

    if (index > 0 && !hasVerifiedTransition) unverifiedTransitionCount25 += 1

    return {
      sessionDate: item.sessionDate,
      distributionCount: count,
      distributionWindow: item.distributionWindow || null,
      totalMatchedVolume: volume,
      vnindexChangePct: item.vnindexChangePct != null && Number.isFinite(item.vnindexChangePct)
        ? item.vnindexChangePct
        : null,
      isDistributionDay: hasVerifiedTransition && count === previousCount + 1,
      isExpiry: hasVerifiedTransition && count < previousCount,
      volumeChangePct: volume != null && previousVolume != null
        ? ((volume - previousVolume) / previousVolume) * 100
        : null,
    }
  })

  const markedIndexes = sessions.flatMap((item, index) => item.isDistributionDay ? [index] : [])
  const lastMarkIndex = markedIndexes.at(-1)
  const recent10 = sessions.slice(-10)

  return {
    sessions,
    currentDistributionCount: canonicalCount(input.currentDistributionCount),
    currentDistributionWindow: input.currentDistributionWindow || sessions.at(-1)?.distributionWindow || null,
    verifiedMarks10: recent10.filter((item) => item.isDistributionDay).length,
    verifiedMarks25: markedIndexes.length,
    expiryCount25: sessions.filter((item) => item.isExpiry).length,
    latestMarkSessionsAgo: lastMarkIndex == null ? null : sessions.length - 1 - lastMarkIndex,
    unverifiedTransitionCount25,
  }
}
