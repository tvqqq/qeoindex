import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { hasVietnamSecuritiesTradingCalendarCoverage, isVietnamSecuritiesTradingDateKey, vietnamDateKey } from "../calendar"
import { listVerifiedColdManifests } from "./cold-store"

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

/**
 * Proves that every authoritative Vietnam trading session intersecting the
 * requested old range has at least one verified RAW manifest. This is a
 * source-coverage proof only; derived-cache readiness is validated separately.
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
  if (!manifests.length) return false
  const datesWithManifest = new Set(manifests.map((manifest) => vietnamDateKey(manifest.rangeStart * 1000)))
  return requiredDates.every((dateKey) => datesWithManifest.has(dateKey))
}
