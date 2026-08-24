import { getAdminJobDefinition } from "./catalog.ts"
import { executeSystemJob } from "./job-telemetry.ts"
import { sanitizeAdminValue } from "./redact.ts"
import { validateChangeReason } from "./request-security.ts"
import type { AdminJobGroup, AdminManualPolicy } from "./types.ts"

export const ALLOWLISTED_MANUAL_JOB_KEYS = [
  "market.sync_universe",
  "market.intraday_5m",
  "scanner.run",
  "signals.daily",
] as const

export type AllowlistedManualJobKey = (typeof ALLOWLISTED_MANUAL_JOB_KEYS)[number]

export interface ManualJobCapability {
  key: string
  label: string
  description: string
  manualPolicy: AdminManualPolicy
  group: AdminJobGroup
}

export interface DispatchManualAdminJobInput {
  key: string
  actorUserId: string
  reason: string
  requestId: string
}

export interface AdminJobExecutionResult {
  ok: boolean
  jobKey: string
  runId: string | null
  durationMs: number
  summary?: Record<string, unknown>
  error?: string
}

export function isManualJobAllowed(jobKey: string): boolean {
  return (ALLOWLISTED_MANUAL_JOB_KEYS as readonly string[]).includes(jobKey)
}

export function getManualJobCapabilities(): ManualJobCapability[] {
  return ALLOWLISTED_MANUAL_JOB_KEYS.map((key) => {
    const def = getAdminJobDefinition(key)
    return {
      key,
      label: def?.label ?? key,
      description: def?.description ?? "",
      manualPolicy: def?.manualPolicy ?? "allowed",
      group: (def?.group ?? "system") as AdminJobGroup,
    }
  })
}

async function writeAuditLog(entry: {
  actorUserId: string
  action: string
  targetType: string
  targetKey: string
  reason: string
  requestId: string
  success: boolean
  beforeValue?: unknown
  afterValue?: unknown
  errorMessage?: string
}) {
  try {
    const { getSupabaseServerClient } = await import("../supabase/server.ts")
    const supabase = getSupabaseServerClient()
    if (!supabase) return

    await supabase.from("system_audit_log").insert({
      actor_user_id: entry.actorUserId,
      action: entry.action,
      target_type: entry.targetType,
      target_key: entry.targetKey,
      reason: entry.reason,
      request_id: entry.requestId,
      success: entry.success,
      before_value: sanitizeAdminValue(entry.beforeValue ?? null) as Record<string, unknown> | null,
      after_value: sanitizeAdminValue(entry.afterValue ?? null) as Record<string, unknown> | null,
      error_message: entry.errorMessage ?? null,
    })
  } catch (err: unknown) {
    console.warn("Failed to persist admin audit log:", err)
  }
}

async function runMarketSyncJob(): Promise<Record<string, unknown>> {
  const { CANONICAL_UNIVERSE_TICKERS } = await import("../wyckoff-universe.ts")
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service role not available")

  const feedUrl = `https://bgapidatafeed.vps.com.vn/getliststockdata/${CANONICAL_UNIVERSE_TICKERS.join(",")}`
  const response = await fetch(feedUrl, {
    headers: { "User-Agent": "Mozilla/5.0 QeoIndex/1.0" },
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error(`Market data provider returned HTTP ${response.status}`)
  }

  const feedData = await response.json()
  if (!Array.isArray(feedData) || feedData.length === 0) {
    throw new Error("Market data provider returned no rows")
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  const records: Array<Record<string, unknown>> = []
  for (const rawItem of feedData) {
    const item = (rawItem && typeof rawItem === "object" ? rawItem : {}) as Record<string, unknown>
    const symbol = String(item.sym || "").toUpperCase()
    if (!symbol) continue
    const price = Number(item.lastPrice ?? 0)
    const reference = Number(item.r ?? 0)
    const change = Number(item.ot ?? (price > 0 && reference > 0 ? price - reference : 0))
    const changePercent = Number(item.changePc ?? (reference > 0 ? (change / reference) * 100 : 0))
    const totalVolume = Number(item.lot ?? 0)
    const totalValue = Number(item.totalValue ?? 0)

    records.push({
      symbol,
      date: today,
      price,
      reference,
      change,
      change_percent: changePercent,
      total_volume: totalVolume,
      total_value: totalValue,
      updated_at: new Date().toISOString(),
    })
  }

  if (records.length) {
    const { error } = await supabase.from("market_universe_daily").upsert(records, { onConflict: "symbol,date" })
    if (error) throw new Error(`Market universe upsert failed: ${error.message}`)
  }

  return {
    date: today,
    symbolsSynced: records.length,
    timestamp: new Date().toISOString(),
  }
}

async function runIntraday5mJob(): Promise<Record<string, unknown>> {
  const { CANONICAL_UNIVERSE_TICKERS } = await import("../wyckoff-universe.ts")
  const { getIntraday5mSnapshot } = await import("../intraday-5m-service.ts")
  const snapshot = await getIntraday5mSnapshot(CANONICAL_UNIVERSE_TICKERS.slice(0, 100))
  return {
    rowsLoaded: snapshot.rows.length,
    generatedAt: snapshot.generatedAt,
  }
}

async function runScannerJob(): Promise<Record<string, unknown>> {
  const { runScannerUniverse } = await import("../scanner-runner.ts")
  const result = await runScannerUniverse()
  return {
    ok: result.ok,
    universeDate: result.universeDate,
    completed: result.completed.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
  }
}

async function runSignalsDailyJob(): Promise<Record<string, unknown>> {
  const { start } = await import("workflow/api")
  const { dailySignalWorkflow } = await import("../../workflows/daily-signal-workflow.ts")
  const startedAt = new Date().toISOString()
  const run = await start(dailySignalWorkflow, [startedAt])
  return {
    runId: run.runId,
    startedAt,
  }
}

export async function dispatchManualAdminJob(input: DispatchManualAdminJobInput): Promise<AdminJobExecutionResult> {
  const startTime = Date.now()

  if (!isManualJobAllowed(input.key)) {
    return {
      ok: false,
      jobKey: input.key,
      runId: null,
      durationMs: 0,
      error: "Tác vụ này không cho phép chạy thủ công qua Control Plane.",
    }
  }

  const validReason = validateChangeReason(input.reason)
  if (!validReason) {
    return {
      ok: false,
      jobKey: input.key,
      runId: null,
      durationMs: 0,
      error: "Lý do thực thi phải từ 8 đến 240 ký tự.",
    }
  }

  try {
    const { runId, result } = await executeSystemJob({
      jobKey: input.key,
      trigger: "manual",
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      fn: async () => {
        if (input.key === "market.sync_universe") {
          return await runMarketSyncJob()
        }
        if (input.key === "market.intraday_5m") {
          return await runIntraday5mJob()
        }
        if (input.key === "scanner.run") {
          return await runScannerJob()
        }
        if (input.key === "signals.daily") {
          return await runSignalsDailyJob()
        }
        throw new Error(`Unhandled job: ${input.key}`)
      },
      extractSummary: (res) => (typeof res === "object" && res !== null ? res : { result: res }),
    })

    const sanitizedSummary = sanitizeAdminValue(result) as Record<string, unknown>

    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "job.run",
      targetType: "job",
      targetKey: input.key,
      reason: validReason,
      requestId: input.requestId,
      success: true,
      afterValue: sanitizedSummary,
    })

    return {
      ok: true,
      jobKey: input.key,
      runId,
      durationMs: Date.now() - startTime,
      summary: sanitizedSummary,
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    await writeAuditLog({
      actorUserId: input.actorUserId,
      action: "job.run",
      targetType: "job",
      targetKey: input.key,
      reason: validReason,
      requestId: input.requestId,
      success: false,
      errorMessage,
    })

    return {
      ok: false,
      jobKey: input.key,
      runId: null,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    }
  }
}
