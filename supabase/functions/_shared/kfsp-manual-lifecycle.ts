import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

export type ManualKfspJobKey = "kfsp.rating_daily" | "kfsp.ttai_history"

export type ManualKfspContext = {
  requestId: string
  jobKey: ManualKfspJobKey
  syncRunId: string
}

type JsonPrimitive = string | number | boolean | null
type SafeJson = JsonPrimitive | SafeJson[] | { [key: string]: SafeJson }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BLOCKED_SUMMARY_KEY = /(secret|token|password|credential|authorization|header|raw|payload)/i

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function sanitizeValue(value: unknown, depth = 0): SafeJson {
  if (depth >= 4) return "[truncated]"
  if (value == null || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") return value.slice(0, 240)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1))
  const object = objectValue(value)
  if (!object) return String(value).slice(0, 240)
  const entries = Object.entries(object)
    .filter(([key]) => !BLOCKED_SUMMARY_KEY.test(key))
    .slice(0, 32)
    .map(([key, nested]) => [key.slice(0, 80), sanitizeValue(nested, depth + 1)] as const)
  return Object.fromEntries(entries)
}

export function sanitizeManualKfspSummary(summary: Record<string, unknown> = {}): Record<string, SafeJson> {
  return sanitizeValue(summary) as Record<string, SafeJson>
}

export function manualKfspRequestId(requestBody: unknown): string | null {
  const body = objectValue(requestBody)
  if (body?.source !== "manual_recovery_rpc") return null
  const requestId = typeof body.request_id === "string" ? body.request_id.trim() : ""
  if (!UUID_PATTERN.test(requestId)) throw new Error("KFSP_MANUAL_REQUEST_ID_INVALID")
  return requestId
}

export async function beginManualKfspLifecycle(
  supabase: SupabaseClient,
  input: {
    requestBody: unknown
    jobKey: ManualKfspJobKey
    syncRunId: string
  },
): Promise<{ context: ManualKfspContext | null; duplicate: boolean; status?: string }> {
  const requestId = manualKfspRequestId(input.requestBody)
  if (!requestId) return { context: null, duplicate: false }
  if (input.syncRunId !== requestId) throw new Error("KFSP_MANUAL_CORRELATION_INVALID")

  const { data, error } = await supabase.rpc("qeo_begin_kfsp_manual_lifecycle", {
    p_request_id: requestId,
    p_job_key: input.jobKey,
    p_sync_run_id: input.syncRunId,
  })
  if (error) throw new Error(`KFSP_MANUAL_BEGIN_FAILED:${String(error.code || "unknown").slice(0, 40)}`)

  const result = objectValue(data)
  const context: ManualKfspContext = {
    requestId,
    jobKey: input.jobKey,
    syncRunId: input.syncRunId,
  }
  return {
    context,
    duplicate: result?.duplicate === true,
    status: typeof result?.status === "string" ? result.status : undefined,
  }
}

export async function finalizeManualKfspLifecycle(
  supabase: SupabaseClient,
  input: {
    context: ManualKfspContext | null
    success: boolean
    summary?: Record<string, unknown>
    errorCode?: string | null
    errorMessage?: string | null
  },
): Promise<void> {
  if (!input.context) return

  const safeSummary = sanitizeManualKfspSummary(input.summary || {})
  const { error } = await supabase.rpc("qeo_finalize_kfsp_manual_lifecycle", {
    p_request_id: input.context.requestId,
    p_job_key: input.context.jobKey,
    p_success: input.success,
    p_summary: safeSummary,
    p_error_code: input.success ? null : String(input.errorCode || "KFSP_PROVIDER_FAILED").slice(0, 100),
    p_error_message: input.success ? null : String(input.errorMessage || "KFSP provider execution failed.").slice(0, 500),
  })
  if (error) throw new Error(`KFSP_MANUAL_FINALIZE_FAILED:${String(error.code || "unknown").slice(0, 40)}`)
}
