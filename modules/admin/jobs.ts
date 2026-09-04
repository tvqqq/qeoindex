import { getAdminJobDefinition } from "./catalog.ts"
import { getEffectiveAdminJobDefinition } from "./effective-job-catalog.ts"
import { executeSystemJob } from "./job-telemetry.ts"
import {
  ALLOWLISTED_MANUAL_JOB_KEYS,
  isAllowlistedManualJobKey,
  type AllowlistedManualJobKey,
} from "./manual-job-capabilities.ts"
import { sanitizeAdminValue } from "./redact.ts"
import { validateChangeReason } from "./request-security.ts"
import type { AdminJobGroup, AdminManualPolicy, AdminManualPurpose } from "./types.ts"

export { ALLOWLISTED_MANUAL_JOB_KEYS, type AllowlistedManualJobKey }

export interface ManualJobCapability {
  key: string
  label: string
  description: string
  manualPolicy: AdminManualPolicy
  manualPurpose?: AdminManualPurpose
  automatedParentKeys?: string[]
  group: AdminJobGroup
}

export interface ManualJobParams {
  limit?: number
  offset?: number
  tickers?: string[]
  force?: boolean
}

export interface DispatchManualAdminJobInput {
  key: string
  actorUserId: string
  reason: string
  requestId: string
  confirmed?: boolean
  params?: ManualJobParams
}

export interface AdminJobExecutionResult {
  ok: boolean
  jobKey: string
  runId: string | null
  durationMs: number
  summary?: Record<string, unknown>
  error?: string
}

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

function getManualAdminJobDefinition(key: string) {
  return getEffectiveAdminJobDefinition(key) ?? getAdminJobDefinition(key)
}

export function isManualJobAllowed(jobKey: string): boolean {
  return isAllowlistedManualJobKey(jobKey)
}

export function getManualJobCapabilities(): ManualJobCapability[] {
  return ALLOWLISTED_MANUAL_JOB_KEYS.map((key) => {
    const def = getManualAdminJobDefinition(key)
    return {
      key,
      label: def?.label ?? key,
      description: def?.description ?? "",
      manualPolicy: def?.manualPolicy ?? "allowed",
      manualPurpose: def?.manualPurpose,
      automatedParentKeys: def?.automatedParentKeys,
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
    const { getSupabaseServerClient } = await import("../shared/supabase/server.ts")
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

async function runScannerJob(params?: ManualJobParams): Promise<Record<string, unknown>> {
  const { runScannerUniverse } = await import("../signals/scanner/runner.ts")
  const result = await runScannerUniverse(params)
  return {
    ok: result.ok,
    universeDate: result.universeDate,
    requested: result.requested,
    completed: result.completed.length,
    skipped: result.skipped.length,
    errors: result.errors.length,
  }
}

function normalizeKfspTickers(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[;,\s]+/)
      : []
  return [...new Set(values
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((ticker) => TICKER_PATTERN.test(ticker)))]
}

async function runKfspRecoveryDispatch(input: DispatchManualAdminJobInput): Promise<Record<string, unknown>> {
  const isTtai = input.key === "kfsp.ttai_history"
  const tickers = normalizeKfspTickers(input.params?.tickers)

  if (isTtai && (tickers.length < 1 || tickers.length > 50)) {
    throw new Error("TTAI recovery yêu cầu từ 1 đến 50 mã cổ phiếu hợp lệ.")
  }
  if (!isTtai && tickers.length > 0) {
    throw new Error("KFSP Rating recovery không nhận danh sách mã riêng lẻ.")
  }

  const definition = getManualAdminJobDefinition(input.key)
  const maxDurationMinutes = Math.max(1, Math.min(240, definition?.maxDurationMinutes ?? 15))

  const { getSupabaseServerClient } = await import("../shared/supabase/server.ts")
  const supabase = getSupabaseServerClient()
  if (!supabase) throw new Error("Supabase service client chưa được cấu hình.")

  const { data, error } = await supabase.rpc("qeo_dispatch_kfsp_job", {
    p_job_key: input.key,
    p_request_id: input.requestId,
    p_reason: input.reason,
    p_tickers: isTtai ? tickers : null,
    p_force: isTtai ? input.params?.force === true : false,
    p_requested_by: input.actorUserId,
    p_actor_user_id: input.actorUserId,
    p_max_duration_minutes: maxDurationMinutes,
  })
  if (error) throw new Error(`KFSP recovery dispatch thất bại (${error.code || "unknown"}).`)

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null
  if (!row || !row.request_id || !row.net_request_id || !row.system_job_run_id) {
    throw new Error("KFSP recovery dispatcher không trả về request evidence hợp lệ.")
  }

  const state = typeof row.status === "string" ? row.status : "queued"
  return {
    ok: true,
    queued: state === "queued" || state === "running",
    state: row.status ?? "queued",
    requestId: row.request_id,
    systemJobRunId: row.system_job_run_id,
    syncRunId: row.sync_run_id ?? undefined,
    netRequestId: row.net_request_id,
    duplicate: row.duplicate === true,
    tickers: isTtai ? tickers : undefined,
    force: isTtai ? input.params?.force === true : undefined,
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

  const definition = getManualAdminJobDefinition(input.key)
  if (definition?.manualPolicy === "confirm" && input.confirmed !== true) {
    return { ok: false, jobKey: input.key, runId: null, durationMs: 0, error: "Tác vụ yêu cầu xác nhận rõ ràng trước khi chạy." }
  }

  if (input.key === "kfsp.rating_daily" || input.key === "kfsp.ttai_history") {
    try {
      const result = await runKfspRecoveryDispatch(input)
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
        runId: String(sanitizedSummary.systemJobRunId ?? input.requestId),
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

  try {
    const { runId, result } = await executeSystemJob({
      jobKey: input.key,
      trigger: "manual",
      actorUserId: input.actorUserId,
      telemetry: "required",
      fn: async () => {
        if (input.key === "market.sync_universe") {
          const { runMarketUniverseSync } = await import("../market/universe/sync.ts")
          return await runMarketUniverseSync()
        }
        if (input.key === "scanner.run") return await runScannerJob(input.params)
        if (input.key === "signals.monitor") {
          const { runSignalMonitor } = await import("../signals/monitor.ts")
          return await runSignalMonitor({ force: true })
        }
        if (input.key === "wyckoff.ingest") {
          const { ingestLatestReadyWyckoffRun } = await import("../wyckoff/notion-ingest.ts")
          return await ingestLatestReadyWyckoffRun()
        }
        throw new Error(`Unhandled job: ${input.key}`)
      },
      extractSummary: (result) => sanitizeAdminValue(result) as Record<string, unknown>,
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
