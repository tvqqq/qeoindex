import { getAdminJobDefinition } from "./catalog.ts"
import { executeSystemJob } from "./job-telemetry.ts"
import { sanitizeAdminValue } from "./redact.ts"
import { validateChangeReason } from "./request-security.ts"
import type { AdminJobGroup, AdminManualPolicy } from "./types.ts"

export const ALLOWLISTED_MANUAL_JOB_KEYS = [
  "market.sync_universe",
  "scanner.run",
  "signals.monitor",
  "wyckoff.ingest",
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
  confirmed?: boolean
  params?: { limit?: number; offset?: number }
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

async function runScannerJob(params?: { limit?: number; offset?: number }): Promise<Record<string, unknown>> {
  const { runScannerUniverse } = await import("../scanner-runner.ts")
  const result = await runScannerUniverse(params)
  return {
    ok: result.ok,
    universeDate: result.universeDate,
    completed: result.completed.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
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

  const definition = getAdminJobDefinition(input.key)
  if (definition?.manualPolicy === "confirm" && input.confirmed !== true) {
    return { ok: false, jobKey: input.key, runId: null, durationMs: 0, error: "Tác vụ yêu cầu xác nhận rõ ràng trước khi chạy." }
  }

  try {
    const { runId, result } = await executeSystemJob({
      jobKey: input.key,
      trigger: "manual",
      actorUserId: input.actorUserId,
      telemetry: "required",
      fn: async () => {
        if (input.key === "market.sync_universe") {
          const { runMarketUniverseSync } = await import("../market-sync-universe.ts")
          return await runMarketUniverseSync()
        }
        if (input.key === "scanner.run") {
          return await runScannerJob(input.params)
        }
        if (input.key === "signals.monitor") {
          const { runSignalMonitor } = await import("../signal-monitor.ts")
          return await runSignalMonitor({ force: true })
        }
        if (input.key === "wyckoff.ingest") {
          const { ingestLatestReadyWyckoffRun } = await import("../wyckoff-notion-ingest.ts")
          return await ingestLatestReadyWyckoffRun()
        }
        throw new Error(`Unhandled job: ${input.key}`)
      },
      extractSummary: (res) => sanitizeAdminValue(res) as Record<string, unknown>,
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
