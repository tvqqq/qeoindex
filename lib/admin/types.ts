export type AdminSettingGroup =
  | "system"
  | "provider"
  | "cache"
  | "market"
  | "scanner"
  | "signals"
  | "wyckoff"
  | "ai_council"
  | "ui"
  | "integration"

export type AdminJobGroup = AdminSettingGroup

export type AdminSettingKind =
  | "boolean"
  | "integer"
  | "number"
  | "string"
  | "enum"
  | "ticker_list"
  | "url"

export type AdminSource = "runtime" | "environment" | "code" | "build"

export type AdminSensitivity = "public" | "internal" | "secret"

export type AdminImpact = "low" | "medium" | "high"

export type AdminJobStatus = "healthy" | "degraded" | "failing" | "stale" | "unknown"

export type AdminManualPolicy = "disabled" | "allowed" | "confirm"

export type AdminValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

export type AdminSettingDefinition = {
  key: string
  group: AdminSettingGroup
  label: string
  description: string
  type: AdminSettingKind
  source: AdminSource
  envKey?: string
  defaultValue?: unknown
  editable: boolean
  sensitivity: AdminSensitivity
  impact: AdminImpact
  requiresDeployment: boolean
  validate(value: unknown): AdminValidationResult
}

export type ResolvedAdminSetting = {
  key: string
  group: AdminSettingGroup
  label: string
  description: string
  type: AdminSettingKind
  editable: boolean
  sensitivity: AdminSensitivity
  impact: AdminImpact
  requiresDeployment: boolean
  value: unknown
  version: number | null
  resolvedFrom: AdminSource
  hasOverride: boolean
  envConfigured: boolean
  updatedAt: string | null
  updatedBy: string | null
  changeReason: string | null
}

export type PersistedSettingRow = {
  key: string
  value: unknown
  version: number
  updated_by?: string | null
  change_reason?: string | null
  updated_at?: string | null
}

export type AdminSettingsSnapshot = {
  settings: ResolvedAdminSetting[]
  byKey: Record<string, ResolvedAdminSetting>
  degraded: boolean
  error?: string
}

export type AdminSettingMutationResult = {
  ok: boolean
  conflict?: boolean
  current?: ResolvedAdminSetting | null
  record?: unknown
  error?: string
}

export type AiCouncilRuntimeConfig = {
  llmEnabled: boolean
  maxTickers: number
  tickers: string[]
  researchTickers: string[]
}

export type AdminEnvironmentItem = {
  key: string
  group: AdminSettingGroup
  label: string
  description: string
  sensitivity: AdminSensitivity
  isConfigured: boolean
  value?: string
  note?: string
}

export type AdminScheduleKind = "point" | "interval" | "manual" | "workflow"

export type AdminJobEvidenceSource =
  | "system_job_runs"
  | "kfsp_rating_sync_runs"
  | "kfsp_ttai_sync_runs"
  | "stock_orderbook_snapshots"
  | "none"

export type AdminSchedulerStatus = "active" | "inactive" | "unscheduled" | "unknown"

export type AdminJobDefinition = {
  key: string
  provider: string
  label: string
  description: string
  group: AdminSettingGroup
  scheduleUtc?: string
  scheduleIct?: string
  scheduleKind?: AdminScheduleKind
  schedulerName?: string
  scheduleDays?: "weekdays" | "daily"
  windowStartIct?: string
  windowEndIct?: string
  intervalMinutes?: number
  dependencies?: string[]
  evidenceSource?: AdminJobEvidenceSource
  manualPolicy: AdminManualPolicy
  freshnessMinutes: number
  maxDurationMinutes: number
}

export type AdminJobView = {
  key: string
  provider: string
  label: string
  description: string
  group: AdminSettingGroup
  scheduleUtc?: string
  scheduleIct?: string
  scheduleKind?: AdminScheduleKind
  schedulerName?: string
  scheduleDays?: "weekdays" | "daily"
  windowStartIct?: string
  windowEndIct?: string
  intervalMinutes?: number
  dependencies?: string[]
  manualPolicy: AdminManualPolicy
  status: AdminJobStatus
  schedulerStatus?: AdminSchedulerStatus
  schedulerLastStatus?: string | null
  schedulerLastStartedAt?: string | null
  schedulerLastFinishedAt?: string | null
  executionStatus?: AdminJobStatus
  evidenceSource?: AdminJobEvidenceSource
  healthReason?: string
  conflictWarning?: string | null
  lastRunId?: string | null
  lastTrigger?: string | null
  lastStartedAt?: string | null
  lastFinishedAt?: string | null
  lastDurationMs?: number | null
  lastSummary?: Record<string, unknown> | null
  lastErrorCode?: string | null
  lastErrorMessage?: string | null
}

export type AdminAuditView = {
  id: number
  actorUserId: string | null
  action: string
  targetType: string
  targetKey: string
  beforeValue: unknown
  afterValue: unknown
  reason: string
  requestId: string
  success: boolean
  errorMessage?: string | null
  createdAt: string
}

export type AdminSourceHealth = {
  name: string
  status: "healthy" | "degraded" | "failing"
  message?: string
  latencyMs?: number
}

export type AdminSystemOverview = {
  actorUserId: string
  refreshedAt: string
  build: {
    commitSha: string
    commitDate?: string
    nodeEnv: string
    vercelEnv?: string
  }
  sources: AdminSourceHealth[]
  jobCounts: {
    total: number
    healthy: number
    degraded: number
    failing: number
    stale: number
    unknown: number
  }
  jobs: AdminJobView[]
  settings: ResolvedAdminSetting[]
  environment: AdminEnvironmentItem[]
  audit: AdminAuditView[]
}
