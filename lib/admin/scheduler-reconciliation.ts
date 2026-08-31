import type { CronSnapshotRow } from "./job-evidence.ts"

export type SchedulerEvidence =
  | { availability: "available"; rows: CronSnapshotRow[] }
  | { availability: "unavailable"; reason: "rpc_error" | "invalid_response" }

export type ExpectedSchedulerMapping = { jobKey: string; schedulerName: string; schedule: string; aliases?: string[] }

export const EXPECTED_SUPABASE_SCHEDULERS: ExpectedSchedulerMapping[] = [
  { jobKey: "qeoindex.eod_pipeline", schedulerName: "qeoindex-eod-pipeline-1515-ict", schedule: "15 8 * * 1-5" },
  { jobKey: "kfsp.rating_daily", schedulerName: "kfsp-rating-daily-7am-ict", schedule: "0 0 * * *" },
  { jobKey: "kfsp.ttai_history", schedulerName: "kfsp-ttai-history-daily-0710-ict", schedule: "10 0 * * *", aliases: ["kfsp-ttai-history-daily-1am-ict", "kfsp-ttai-history-hourly"] },
  { jobKey: "market.sync_5m", schedulerName: "sync-universe-5m", schedule: "*/5 2-6 * * 1-5" },
  { jobKey: "market.sync_5m", schedulerName: "sync-universe-5m-afternoon", schedule: "0-40/5 7 * * 1-5" },
  { jobKey: "market.sync_eod", schedulerName: "sync-universe-eod-1445", schedule: "45 7 * * 1-5", aliases: ["sync-universe-eod-1450"] },
]
export const EXPECTED_VERCEL_SCHEDULERS = [{ jobKey: "signals.daily", path: "/api/signals/daily", schedule: "0 0 * * 1-5" }] as const
export type VercelCronEntry = { path: string; schedule: string }

export type SchedulerMappingResult = ExpectedSchedulerMapping & { status: "live_verified" | "missing" | "drifted" | "inactive" | "duplicated" | "legacy_alias"; jobId?: number }
export type SchedulerReconciliation = {
  availability: SchedulerEvidence["availability"]
  mappings: SchedulerMappingResult[]
  extraUnmapped: string[]
  aggregate: { expected: number; liveVerified: number; configOnly: number; missing: number; drifted: number; duplicated: number; unavailable: number; extraUnmapped: number; inventoryClean: boolean; expectedMappingsVerified: boolean }
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ")

export function reconcileSupabaseSchedulers(evidence: SchedulerEvidence): SchedulerReconciliation {
  if (evidence.availability === "unavailable") return {
    availability: evidence.availability, mappings: [], extraUnmapped: [],
    aggregate: { expected: 6, liveVerified: 0, configOnly: 0, missing: 0, drifted: 0, duplicated: 0, unavailable: 6, extraUnmapped: 0, inventoryClean: false, expectedMappingsVerified: false },
  }
  const mappings = EXPECTED_SUPABASE_SCHEDULERS.map((expected) => {
    const direct = evidence.rows.filter((row) => row.jobName === expected.schedulerName)
    const aliases = evidence.rows.filter((row) => expected.aliases?.includes(row.jobName))
    if (direct.length > 1) return { ...expected, status: "duplicated" as const }
    if (!direct.length && aliases.length) return { ...expected, status: "legacy_alias" as const, jobId: aliases[0].jobId }
    if (!direct.length) return { ...expected, status: "missing" as const }
    const row = direct[0]
    if (normalize(row.schedule) !== normalize(expected.schedule)) return { ...expected, status: "drifted" as const, jobId: row.jobId }
    if (!row.active) return { ...expected, status: "inactive" as const, jobId: row.jobId }
    return { ...expected, status: "live_verified" as const, jobId: row.jobId }
  })
  const claimed = new Set(EXPECTED_SUPABASE_SCHEDULERS.flatMap((mapping) => [mapping.schedulerName, ...(mapping.aliases ?? [])]))
  const extraUnmapped = evidence.rows.filter((row) => !claimed.has(row.jobName)).map((row) => row.jobName)
  const liveVerified = mappings.filter((m) => m.status === "live_verified").length
  const drifted = mappings.filter((m) => m.status === "drifted").length
  const duplicated = mappings.filter((m) => m.status === "duplicated").length
  const missing = mappings.filter((m) => m.status === "missing" || m.status === "legacy_alias" || m.status === "inactive").length
  return { availability: "available", mappings, extraUnmapped, aggregate: { expected: 6, liveVerified, configOnly: 1, missing, drifted, duplicated, unavailable: 0, extraUnmapped: extraUnmapped.length, inventoryClean: liveVerified === 6 && extraUnmapped.length === 0, expectedMappingsVerified: liveVerified === 6 } }
}

export function reconcileVercelSchedulers(entries: VercelCronEntry[]) {
  const expected = EXPECTED_VERCEL_SCHEDULERS[0]
  const matching = entries.filter((entry) => entry.path === expected.path)
  const status = matching.length > 1 ? "duplicated" : matching.length === 0 ? "missing" : normalize(matching[0].schedule) === normalize(expected.schedule) ? "config_only" : "drifted"
  return { jobKey: expected.jobKey, status, expectedPath: expected.path, expectedSchedule: expected.schedule, inventoryClean: status === "config_only" && entries.every((entry) => entry.path === expected.path) }
}
