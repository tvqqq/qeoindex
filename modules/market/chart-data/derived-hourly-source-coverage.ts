import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { hasVietnamSecuritiesTradingCalendarCoverage, isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar"
import { listVerifiedColdManifests } from "./cold-store"
import { readProviderRequestCoverage } from "./hot-store"
import { missingTradingProviderRanges } from "./provider-coverage"

function vietnamSessionStart(dateKey: string, hour: number, minute = 0) {
  return Math.floor(new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`).getTime() / 1000)
}

function nextVietnamDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00+07:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return vietnamDateKey(date)
}

function requiredTradingDates(from: number, to: number): string[] | null {
  const required: string[] = []
  let dateKey = vietnamDateKey(from * 1000)
  const last = vietnamDateKey(to * 1000)
  while (dateKey <= last) {
    if (!hasVietnamSecuritiesTradingCalendarCoverage(dateKey)) return null
    if (isVietnamSecuritiesTradingDateKey(dateKey)) {
      const morningFrom = vietnamSessionStart(dateKey, 9)
      const morningTo = vietnamSessionStart(dateKey, 11, 30) - 1
      const afternoonFrom = vietnamSessionStart(dateKey, 13)
      const afternoonTo = vietnamSessionStart(dateKey, 15) - 1
      if ((from <= morningTo && to >= morningFrom) || (from <= afternoonTo && to >= afternoonFrom)) required.push(dateKey)
    }
    dateKey = nextVietnamDateKey(dateKey)
  }
  return required
}

function dateRange(dateKey: string) {
  return {
    from: vietnamSessionStart(dateKey, 0),
    to: vietnamSessionStart(nextVietnamDateKey(dateKey), 0) - 1,
  }
}

/**
 * Proves that every authoritative Vietnam trading session intersecting the
 * requested old range still has verified RAW authority. Archived sessions are
 * proven by verified COLD manifests; sessions whose archive is lagging may be
 * proven by QEO-148 durable provider-success coverage published only after
 * canonical HOT persistence completed. Derived-cache readiness remains a
 * separate fail-closed proof.
 */
export async function verifiedHourlySourceCoverageComplete(
  supabase: SupabaseClient,
  input: { ticker: string; from: number; to: number },
): Promise<boolean> {
  if (input.to < input.from) return true
  const requiredDates = requiredTradingDates(input.from, input.to)
  if (requiredDates == null) return false
  if (!requiredDates.length) return true

  const manifests = await listVerifiedColdManifests(supabase, {
    ticker: input.ticker,
    from: input.from,
    to: input.to,
    baseResolution: "1m",
  })
  const datesWithManifest = new Set(manifests.map((manifest) => vietnamDateKey(manifest.rangeStart * 1000)))
  const unarchivedDates = requiredDates.filter((dateKey) => !datesWithManifest.has(dateKey))
  if (!unarchivedDates.length) return true

  const durableHotCoverage = await readProviderRequestCoverage(supabase, input.ticker, input.from, input.to)
  if (!durableHotCoverage.length) return false

  return unarchivedDates.every((dateKey) => {
    const day = dateRange(dateKey)
    const request = {
      from: Math.max(input.from, day.from),
      to: Math.min(input.to, day.to),
    }
    return missingTradingProviderRanges(request, durableHotCoverage).length === 0
  })
}
