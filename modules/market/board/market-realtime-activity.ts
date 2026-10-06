import { getMarketSessionStatus } from "../realtime/session-countdown.ts"
import { vietnamDateKey } from "../calendar.ts"

export type MarketCardActivity = "live" | "delayed" | "closed" | "unavailable"

/**
 * Visible market motion is evidence of a verified, same-session provider tick,
 * never proof of exchange connectivity. Receipt times and old snapshots do not qualify.
 */
export function getMarketCardActivity({
  sources,
  sessionDay,
  nowMs,
  canStream = true,
}: {
  sources: readonly (string | null | undefined)[]
  sessionDay: string
  nowMs: number
  canStream?: boolean
}): MarketCardActivity {
  if (!Number.isFinite(nowMs)) return "unavailable"
  const now = new Date(nowMs)
  if (!getMarketSessionStatus(now).isLiveSession) return "closed"
  if (!canStream || !sessionDay || sessionDay !== vietnamDateKey(now)) return "unavailable"
  if (!sources.length || sources.some((source) => !source)) return "unavailable"
  const valid = sources.every((source) => {
    const tick = Date.parse(source ?? "")
    return Number.isFinite(tick)
      && vietnamDateKey(new Date(tick)) === sessionDay
      && tick <= nowMs + 5_000
      && nowMs - tick <= 120_000
  })
  return valid ? "live" : "delayed"
}
