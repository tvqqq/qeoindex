export const ALLOWLISTED_MANUAL_JOB_KEYS = [
  "market.sync_universe",
  "scanner.run",
  "signals.monitor",
  "wyckoff.ingest",
  "kfsp.rating_daily",
  "kfsp.ttai_history",
] as const

export type AllowlistedManualJobKey = (typeof ALLOWLISTED_MANUAL_JOB_KEYS)[number]

const ALLOWLISTED_MANUAL_JOB_KEY_SET = new Set<string>(ALLOWLISTED_MANUAL_JOB_KEYS)

export function isAllowlistedManualJobKey(jobKey: string): jobKey is AllowlistedManualJobKey {
  return ALLOWLISTED_MANUAL_JOB_KEY_SET.has(jobKey)
}
