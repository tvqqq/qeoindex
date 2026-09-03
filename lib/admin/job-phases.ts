export const QEOINDEX_EOD_JOB_KEY = "qeoindex.eod_pipeline" as const

export const QEOINDEX_EOD_BUSINESS_PHASES = [
  { key: "DATA_REFRESH", order: 1, label: "Data Refresh", description: "Refresh/freeze same-session KFSP, TTAI và market-close evidence cho canonical universe." },
  { key: "READY_GATE", order: 2, label: "Ready Gate", description: "Xác nhận exact frozen canonical universe và same-session evidence trước downstream analysis." },
  { key: "HISTORY_PREPARE", order: 3, label: "History Prepare", description: "Refresh/backfill raw Daily và repair exact no-trade gaps bằng bounded provider concurrency." },
  { key: "WYCKOFF_PUBLISH", order: 4, label: "Wyckoff Publish", description: "Build → validate → publish Wyckoff facts theo atomic canonical dataset contract." },
  { key: "AI_COUNCIL", order: 5, label: "AI Council", description: "Deterministic Council → Market Synthesis → LLM debate theo dependency order." },
  { key: "POST_ANALYSIS", order: 6, label: "Post Analysis", description: "Safe retention trên canonical Supabase evidence rồi optional one-row Notion analytical summary." },
  { key: "COMPLETE", order: 7, label: "Complete", description: "Đóng parent EOD run với exact coverage và terminal status." },
] as const

export type QeoIndexEodBusinessPhaseKey = (typeof QEOINDEX_EOD_BUSINESS_PHASES)[number]["key"]

export const QEOINDEX_EOD_PHASES = [
  { key: "KFSP_RATING_REFRESH", order: 1, businessPhase: "DATA_REFRESH", label: "KFSP Rating Refresh", description: "Refresh KFSP Rating cho đúng phiên EOD rồi freeze exact canonical universe run trước các evidence downstream." },
  { key: "TTAI_REFRESH", order: 2, businessPhase: "DATA_REFRESH", label: "TTAI Refresh", description: "Refresh TTAI theo frozen canonical universe; partial ticker failures được ghi degraded thay vì giả success." },
  { key: "MARKET_CLOSE_COLLECT", order: 3, businessPhase: "DATA_REFRESH", label: "Market Close Collect", description: "Thu thập snapshot thị trường sau đóng cửa trên frozen canonical universe và publish market read model cùng phiên." },
  { key: "EOD_READY", order: 4, businessPhase: "READY_GATE", label: "EOD Ready", description: "Xác nhận frozen canonical Top Stocks universe và toàn bộ evidence EOD cùng phiên đã sẵn sàng." },
  { key: "HISTORY_REFRESH", order: 5, businessPhase: "HISTORY_PREPARE", label: "History Refresh", description: "Refresh/backfill raw OHLCV 1D cho toàn bộ canonical universe theo bounded window; 1W được derive từ 1D." },
  { key: "WYCKOFF_BUILD", order: 6, businessPhase: "WYCKOFF_PUBLISH", label: "Wyckoff Build", description: "Build Wyckoff 1D/1W; số snapshot kỳ vọng luôn bằng universeCount × 2." },
  { key: "SUPABASE_VALIDATE", order: 7, businessPhase: "WYCKOFF_PUBLISH", label: "Supabase Validate", description: "Validate exact canonical membership, snapshot contract và deterministic validation hash trước publish." },
  { key: "SUPABASE_PUBLISH", order: 8, businessPhase: "WYCKOFF_PUBLISH", label: "Supabase Publish", description: "Publish Wyckoff operational facts trực tiếp vào Supabase; Notion không nằm trên critical path." },
  { key: "AI_COUNCIL_DETERMINISTIC", order: 9, businessPhase: "AI_COUNCIL", label: "AI Council Deterministic", description: "Chạy deterministic Council trên exact frozen membership sau khi Supabase Wyckoff publish thành công." },
  { key: "MARKET_SYNTHESIS", order: 10, businessPhase: "AI_COUNCIL", label: "Market Synthesis", description: "Dispatch market-level AI synthesis sau deterministic Council và trước LLM debate." },
  { key: "AI_COUNCIL_LLM", order: 11, businessPhase: "AI_COUNCIL", label: "AI Council LLM", description: "Chạy LLM debate trên subset được policy chọn sau khi market context đã được dispatch." },
  { key: "RETENTION_CLEANUP", order: 12, businessPhase: "POST_ANALYSIS", label: "Retention Cleanup", description: "Prune safe telemetry/staging theo retention policy; raw Daily OHLCV tiếp tục được giữ trong Supabase và không age-prune." },
  { key: "NOTION_ARCHIVE", order: 13, businessPhase: "POST_ANALYSIS", label: "Notion Analytical Summary", description: "Upsert đúng một human-readable EOD summary từ canonical Supabase evidence; lỗi Notion là fail-open và không chặn COMPLETE." },
  { key: "COMPLETE", order: 14, businessPhase: "COMPLETE", label: "Complete", description: "Đóng parent EOD run và ghi summary của refresh, publication, Council, retention và optional analytical sink." },
] as const

export type QeoIndexEodPhaseKey = (typeof QEOINDEX_EOD_PHASES)[number]["key"]
export const QEOINDEX_EOD_INTERNAL_PHASE_TO_BUSINESS: Readonly<Record<QeoIndexEodPhaseKey, QeoIndexEodBusinessPhaseKey>> = Object.freeze(
  Object.fromEntries(QEOINDEX_EOD_PHASES.map((phase) => [phase.key, phase.businessPhase])) as Record<QeoIndexEodPhaseKey, QeoIndexEodBusinessPhaseKey>,
)

export type StoredJobPhaseStatus = "queued" | "running" | "succeeded" | "failed" | "skipped"
export type AdminJobPhaseStatus = StoredJobPhaseStatus | "pending"
export type AdminEodBusinessPhaseStatus = AdminJobPhaseStatus | "retrying" | "degraded" | "partial"

export interface SystemJobPhaseRow {
  id: string
  run_id: string
  job_key: string
  phase_key: string
  phase_order: number
  status: string
  started_at: string
  finished_at?: string | null
  duration_ms?: number | null
  summary?: Record<string, unknown> | null
  error_code?: string | null
  error_message?: string | null
  created_at?: string
}

export interface AdminJobPhaseView {
  key: QeoIndexEodPhaseKey
  order: number
  businessPhase: QeoIndexEodBusinessPhaseKey
  label: string
  description: string
  status: AdminJobPhaseStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  summary: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
}

export interface AdminEodRunSnapshot {
  id?: string
  status?: string | null
  started_at?: string | null
  finished_at?: string | null
  summary?: Record<string, unknown> | null
  error_code?: string | null
  error_message?: string | null
}

export interface AdminEodTickerAttemptView {
  ticker: string
  stage: string
  status: string
  attempt: number | null
  errorClass: string | null
  retryEligible: boolean
  error: string | null
}

export interface AdminEodBusinessPhaseView {
  key: QeoIndexEodBusinessPhaseKey
  order: number
  label: string
  description: string
  status: AdminEodBusinessPhaseStatus
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  summary: Record<string, number>
  children: AdminJobPhaseView[]
}

export interface AdminEodRunView {
  runId: string | null
  terminalStatus: AdminEodBusinessPhaseStatus
  tradingDate: string | null
  universeRunId: string | null
  universeCount: number | null
  healthyCount: number | null
  failedCount: number | null
  failedTickers: string[]
  retryEligibleTickers: string[]
  tickerAttempts: AdminEodTickerAttemptView[]
  retryAvailable: boolean
  phases: AdminEodBusinessPhaseView[]
}

const STORED_PHASE_STATUSES = new Set<StoredJobPhaseStatus>(["queued", "running", "succeeded", "failed", "skipped"])
const DEGRADED_SUMMARY_STATUSES = new Set(["partial", "degraded", "error", "blocked"])

function normalizePhaseStatus(value: string | undefined): AdminJobPhaseStatus {
  if (!value) return "pending"
  const normalized = value.toLowerCase() as StoredJobPhaseStatus
  return STORED_PHASE_STATUSES.has(normalized) ? normalized : "pending"
}

function normalizeTerminalStatus(value: unknown): AdminEodBusinessPhaseStatus {
  const normalized = String(value || "").trim().toLowerCase()
  if (["succeeded", "success", "completed", "complete"].includes(normalized)) return "succeeded"
  if (normalized === "partial") return "partial"
  if (normalized === "failed" || normalized === "error") return "failed"
  if (normalized === "running") return "running"
  if (normalized === "queued") return "queued"
  if (normalized === "skipped") return "skipped"
  return "pending"
}

function rowTimestamp(row: SystemJobPhaseRow) {
  return row.finished_at || row.started_at || row.created_at || ""
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function firstRecord(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value)
    if (record) return record
  }
  return null
}

function stringField(records: Array<Record<string, unknown> | null>, ...keys: string[]) {
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return null
}

function numberField(records: Array<Record<string, unknown> | null>, ...keys: string[]) {
  for (const record of records) {
    if (!record) continue
    for (const key of keys) {
      const value = Number(record[key])
      if (Number.isFinite(value) && value >= 0) return value
    }
  }
  return null
}

function tickerList(records: Array<Record<string, unknown> | null>, key: string) {
  for (const record of records) {
    if (!record || !Array.isArray(record[key])) continue
    return [...new Set((record[key] as unknown[])
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean))]
      .sort()
  }
  return []
}

function parseTickerAttempts(record: Record<string, unknown> | null): AdminEodTickerAttemptView[] {
  if (!record || !Array.isArray(record.tickerAttempts)) return []
  return record.tickerAttempts
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((attempt) => ({
      ticker: String(attempt.ticker || "").trim().toUpperCase(),
      stage: String(attempt.stage || "unknown").trim(),
      status: String(attempt.status || "unknown").trim().toLowerCase(),
      attempt: Number.isFinite(Number(attempt.attempt)) ? Number(attempt.attempt) : null,
      errorClass: typeof attempt.errorClass === "string" ? attempt.errorClass : null,
      retryEligible: attempt.retryEligible === true,
      error: typeof attempt.error === "string"
        ? attempt.error
        : typeof attempt.errorMessage === "string"
          ? attempt.errorMessage
          : null,
    }))
    .filter((attempt) => Boolean(attempt.ticker))
}

function childIsRetrying(phase: AdminJobPhaseView) {
  return phase.summary?.retrying === true
}

function childIsDegraded(phase: AdminJobPhaseView) {
  const summary = phase.summary
  if (!summary) return false
  for (const key of ["status", "qualityStatus", "terminalStatus"]) {
    const value = String(summary[key] || "").trim().toLowerCase()
    if (DEGRADED_SUMMARY_STATUSES.has(value)) return true
  }
  return false
}

function deriveBusinessPhaseStatus(
  key: QeoIndexEodBusinessPhaseKey,
  children: AdminJobPhaseView[],
  terminalStatus: AdminEodBusinessPhaseStatus,
): AdminEodBusinessPhaseStatus {
  if (key === "COMPLETE" && terminalStatus !== "pending") return terminalStatus
  if (children.some(childIsRetrying)) return "retrying"
  if (children.some((child) => child.status === "failed")) return "failed"
  if (children.some((child) => child.status === "running")) return "running"
  if (children.some((child) => child.status === "queued")) return "queued"
  if (children.some(childIsDegraded)) return "degraded"
  if (children.every((child) => child.status === "pending")) return "pending"
  if (children.every((child) => child.status === "skipped")) return "skipped"
  if (children.every((child) => child.status === "succeeded" || child.status === "skipped")) return "succeeded"
  return "running"
}

function minTimestamp(values: Array<string | null>) {
  const valid = values.filter((value): value is string => Boolean(value)).sort()
  return valid[0] ?? null
}

function maxTimestamp(values: Array<string | null>) {
  const valid = values.filter((value): value is string => Boolean(value)).sort()
  return valid.at(-1) ?? null
}

export function buildAdminJobPhaseTimeline(rows: SystemJobPhaseRow[]): AdminJobPhaseView[] {
  const latestByKey = new Map<string, SystemJobPhaseRow>()
  for (const row of rows) {
    const current = latestByKey.get(row.phase_key)
    if (!current || rowTimestamp(row) >= rowTimestamp(current)) latestByKey.set(row.phase_key, row)
  }
  return QEOINDEX_EOD_PHASES.map((definition) => {
    const row = latestByKey.get(definition.key)
    return {
      key: definition.key,
      order: definition.order,
      businessPhase: definition.businessPhase,
      label: definition.label,
      description: definition.description,
      status: normalizePhaseStatus(row?.status),
      startedAt: row?.started_at ?? null,
      finishedAt: row?.finished_at ?? null,
      durationMs: row?.duration_ms ?? null,
      summary: row?.summary ?? null,
      errorCode: row?.error_code ?? null,
      errorMessage: row?.error_message ?? null,
    }
  })
}

export function buildAdminEodRunView(
  rows: SystemJobPhaseRow[],
  run: AdminEodRunSnapshot | null,
): AdminEodRunView {
  const timeline = buildAdminJobPhaseTimeline(rows)
  const complete = timeline.find((phase) => phase.key === "COMPLETE")?.summary ?? null
  const ready = timeline.find((phase) => phase.key === "EOD_READY")?.summary ?? null
  const runSummary = firstRecord(run?.summary)
  const sources = [runSummary, complete, ready]
  const terminalStatus = normalizeTerminalStatus(run?.status ?? runSummary?.terminalStatus ?? complete?.status)
  const failedTickers = tickerList(sources, "failedTickers")
  const retryEligibleTickers = tickerList(sources, "retryEligibleTickers")
  const tickerAttempts = parseTickerAttempts(runSummary ?? complete)

  const phases = QEOINDEX_EOD_BUSINESS_PHASES.map((definition): AdminEodBusinessPhaseView => {
    const children = timeline.filter((phase) => phase.businessPhase === definition.key)
    const succeeded = children.filter((phase) => phase.status === "succeeded").length
    const failed = children.filter((phase) => phase.status === "failed").length
    const skipped = children.filter((phase) => phase.status === "skipped").length
    const pending = children.filter((phase) => phase.status === "pending").length
    const durationMs = children.reduce((sum, phase) => sum + Math.max(0, Number(phase.durationMs || 0)), 0)
    return {
      ...definition,
      status: deriveBusinessPhaseStatus(definition.key, children, terminalStatus),
      startedAt: minTimestamp(children.map((phase) => phase.startedAt)),
      finishedAt: maxTimestamp(children.map((phase) => phase.finishedAt)),
      durationMs: children.some((phase) => phase.durationMs !== null) ? durationMs : null,
      summary: { total: children.length, succeeded, failed, skipped, pending },
      children,
    }
  })

  return {
    runId: run?.id ? String(run.id) : null,
    terminalStatus,
    tradingDate: stringField(sources, "scanDate", "tradingDate", "sessionDate"),
    universeRunId: stringField(sources, "universeRunId"),
    universeCount: numberField(sources, "universeCount", "expectedCount"),
    healthyCount: numberField(sources, "healthyCount"),
    failedCount: numberField(sources, "failedCount"),
    failedTickers,
    retryEligibleTickers,
    tickerAttempts,
    retryAvailable: terminalStatus === "partial" && Boolean(run?.id) && retryEligibleTickers.length > 0,
    phases,
  }
}
