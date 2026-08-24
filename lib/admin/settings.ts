import { ADMIN_SETTING_CATALOG, getAdminSettingDefinition, validateAdminSetting } from "./catalog.ts"
import { sanitizeAdminValue } from "./redact.ts"
import { validateChangeReason } from "./request-security.ts"
import type {
  AdminSettingDefinition,
  AdminSettingMutationResult,
  AdminSettingsSnapshot,
  AiCouncilRuntimeConfig,
  PersistedSettingRow,
  ResolvedAdminSetting,
} from "./types.ts"

export type { PersistedSettingRow, AdminSettingsSnapshot, AiCouncilRuntimeConfig }

let cachedSnapshot: { snapshot: AdminSettingsSnapshot; expiresAt: number } | null = null
const CACHE_TTL_MS = 15_000

export function invalidateAdminSettingsCache(): void {
  cachedSnapshot = null
}

async function getSupabase() {
  const { getSupabaseServerClient } = await import("../supabase/server.ts")
  return getSupabaseServerClient()
}

export function resolveAdminSettings(
  definitions: AdminSettingDefinition[],
  rows: PersistedSettingRow[],
  env: Record<string, string | undefined> = process.env,
): AdminSettingsSnapshot {
  const rowMap = new Map<string, PersistedSettingRow>()
  for (const row of rows) {
    if (row && typeof row.key === "string") {
      rowMap.set(row.key, row)
    }
  }

  let degraded = false
  const settings: ResolvedAdminSetting[] = []
  const byKey: Record<string, ResolvedAdminSetting> = {}

  for (const def of definitions) {
    let resolvedValue = def.defaultValue
    let resolvedFrom: "runtime" | "environment" | "code" = "code"
    let hasOverride = false
    let version: number | null = null
    let updatedAt: string | null = null
    let updatedBy: string | null = null
    let changeReason: string | null = null
    const envRaw = def.envKey ? env[def.envKey] : undefined
    const envConfigured = envRaw !== undefined && envRaw !== ""

    if (def.editable && rowMap.has(def.key)) {
      const row = rowMap.get(def.key)!
      const validation = def.validate(row.value)
      if (validation.ok) {
        resolvedValue = validation.value
        resolvedFrom = "runtime"
        hasOverride = true
        version = typeof row.version === "number" ? row.version : Number(row.version) || 1
        updatedAt = row.updated_at ?? null
        updatedBy = row.updated_by ?? null
        changeReason = row.change_reason ?? null
      } else {
        degraded = true
      }
    }

    if (!hasOverride && envConfigured) {
      if (def.editable) {
        const validation = def.validate(envRaw)
        if (validation.ok) {
          resolvedValue = validation.value
          resolvedFrom = "environment"
        }
      } else {
        resolvedValue = envRaw
        resolvedFrom = "environment"
      }
    }

    const resolvedSetting: ResolvedAdminSetting = {
      key: def.key,
      group: def.group,
      label: def.label,
      description: def.description,
      type: def.type,
      editable: def.editable,
      sensitivity: def.sensitivity,
      impact: def.impact,
      requiresDeployment: def.requiresDeployment,
      value: resolvedValue,
      version,
      resolvedFrom,
      hasOverride,
      envConfigured,
      updatedAt,
      updatedBy,
      changeReason,
    }

    settings.push(resolvedSetting)
    byKey[def.key] = resolvedSetting
  }

  return {
    settings,
    byKey,
    degraded,
  }
}

export async function loadAdminSettingsSnapshot(): Promise<AdminSettingsSnapshot> {
  const now = Date.now()
  if (cachedSnapshot && cachedSnapshot.expiresAt > now) {
    return cachedSnapshot.snapshot
  }

  const supabase = await getSupabase()
  if (!supabase) {
    const fallback = resolveAdminSettings(ADMIN_SETTING_CATALOG, [], process.env)
    return {
      ...fallback,
      degraded: true,
      error: "Supabase service role client is not available",
    }
  }

  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("key, value, version, updated_by, change_reason, updated_at")

    if (error) {
      const fallback = resolveAdminSettings(ADMIN_SETTING_CATALOG, [], process.env)
      return {
        ...fallback,
        degraded: true,
        error: error.message,
      }
    }

    const rows: PersistedSettingRow[] = (data || []).map((r: { key: string; value: unknown; version: number | string; updated_by?: string | null; change_reason?: string | null; updated_at?: string | null }) => ({
      key: r.key,
      value: r.value,
      version: Number(r.version),
      updated_by: r.updated_by,
      change_reason: r.change_reason,
      updated_at: r.updated_at,
    }))

    const snapshot = resolveAdminSettings(ADMIN_SETTING_CATALOG, rows, process.env)
    cachedSnapshot = {
      snapshot,
      expiresAt: now + CACHE_TTL_MS,
    }
    return snapshot
  } catch (err: unknown) {
    const fallback = resolveAdminSettings(ADMIN_SETTING_CATALOG, [], process.env)
    return {
      ...fallback,
      degraded: true,
      error: err instanceof Error ? err.message : "Unknown error loading settings",
    }
  }
}

export async function setAdminSetting(input: {
  key: string
  value: unknown
  expectedVersion: number
  actorUserId: string
  reason: string
  requestId: string
}): Promise<AdminSettingMutationResult> {
  const definition = getAdminSettingDefinition(input.key)
  if (!definition) {
    return { ok: false, error: `Cài đặt không tồn tại: ${input.key}` }
  }
  if (!definition.editable) {
    return { ok: false, error: `Cài đặt ${input.key} không thể sửa đổi (chỉ đọc)` }
  }

  const validation = validateAdminSetting(input.key, input.value)
  if (!validation.ok) {
    return { ok: false, error: validation.error }
  }

  const validReason = validateChangeReason(input.reason)
  if (!validReason) {
    return { ok: false, error: "Lý do thay đổi phải từ 8 đến 240 ký tự" }
  }

  const supabase = await getSupabase()
  if (!supabase) {
    return { ok: false, error: "Supabase service role client is not available" }
  }

  try {
    const { data, error } = await supabase.rpc("qeo_admin_set_system_setting", {
      p_key: input.key,
      p_value: validation.value,
      p_expected_version: input.expectedVersion,
      p_actor_user_id: input.actorUserId,
      p_reason: validReason,
      p_request_id: input.requestId,
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    invalidateAdminSettingsCache()

    if (data?.ok) {
      return { ok: true, record: sanitizeAdminValue(data.record) }
    }

    if (data?.conflict) {
      return { ok: false, conflict: true, current: sanitizeAdminValue(data.record) as ResolvedAdminSetting | null }
    }

    return { ok: false, error: "Unexpected set setting response" }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set setting" }
  }
}

export async function resetAdminSetting(input: {
  key: string
  expectedVersion: number
  actorUserId: string
  reason: string
  requestId: string
}): Promise<AdminSettingMutationResult> {
  const definition = getAdminSettingDefinition(input.key)
  if (!definition) {
    return { ok: false, error: `Cài đặt không tồn tại: ${input.key}` }
  }
  if (!definition.editable) {
    return { ok: false, error: `Cài đặt ${input.key} không thể sửa đổi (chỉ đọc)` }
  }

  const validReason = validateChangeReason(input.reason)
  if (!validReason) {
    return { ok: false, error: "Lý do khôi phục phải từ 8 đến 240 ký tự" }
  }

  const supabase = await getSupabase()
  if (!supabase) {
    return { ok: false, error: "Supabase service role client is not available" }
  }

  try {
    const { data, error } = await supabase.rpc("qeo_admin_reset_system_setting", {
      p_key: input.key,
      p_expected_version: input.expectedVersion,
      p_actor_user_id: input.actorUserId,
      p_reason: validReason,
      p_request_id: input.requestId,
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    invalidateAdminSettingsCache()

    if (data?.ok) {
      return { ok: true, record: null }
    }

    if (data?.conflict) {
      return { ok: false, conflict: true, current: sanitizeAdminValue(data.record) as ResolvedAdminSetting | null }
    }

    return { ok: false, error: "Unexpected reset setting response" }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reset setting" }
  }
}

export async function getAiCouncilRuntimeConfig(): Promise<AiCouncilRuntimeConfig> {
  const snapshot = await loadAdminSettingsSnapshot()
  return {
    llmEnabled: (snapshot.byKey["ai_council.llm_enabled"]?.value as boolean) ?? true,
    maxTickers: (snapshot.byKey["ai_council.llm_max_tickers"]?.value as number) ?? 3,
    tickers: (snapshot.byKey["ai_council.llm_tickers"]?.value as string[]) ?? [],
    researchTickers: (snapshot.byKey["ai_council.research_tickers"]?.value as string[]) ?? ["MSN"],
  }
}

export async function getAdminUiConfig(): Promise<{ refreshIntervalSeconds: number; jobHistoryLimit: number }> {
  const snapshot = await loadAdminSettingsSnapshot()
  return {
    refreshIntervalSeconds: (snapshot.byKey["admin.refresh_interval_seconds"]?.value as number) ?? 30,
    jobHistoryLimit: (snapshot.byKey["admin.job_history_limit"]?.value as number) ?? 50,
  }
}

export async function getScannerRuntimeConfig(): Promise<{ manualRunLimit: number }> {
  const snapshot = await loadAdminSettingsSnapshot()
  return {
    manualRunLimit: (snapshot.byKey["scanner.manual_run_limit"]?.value as number) ?? 100,
  }
}
