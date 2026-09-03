export const QEOINDEX_EOD_JOB_KEY = "qeoindex.eod_pipeline" as const

export const QEOINDEX_EOD_BUSINESS_PHASES = [
  {
    key: "DATA_REFRESH",
    order: 1,
    label: "Data Refresh",
    description: "Refresh/freeze same-session KFSP, TTAI và market-close evidence cho canonical universe.",
  },
  {
    key: "READY_GATE",
    order: 2,
    label: "Ready Gate",
    description: "Xác nhận exact frozen canonical universe và same-session evidence trước downstream analysis.",
  },
  {
    key: "HISTORY_PREPARE",
    order: 3,
    label: "History Prepare",
    description: "Refresh/backfill raw Daily và repair exact no-trade gaps bằng bounded provider concurrency.",
  },
  {
    key: "WYCKOFF_PUBLISH",
    order: 4,
    label: "Wyckoff Publish",
    description: "Build → validate → publish Wyckoff facts theo atomic canonical dataset contract.",
  },
  {
    key: "AI_COUNCIL",
    order: 5,
    label: "AI Council",
    description: "Deterministic Council → Market Synthesis → LLM debate theo dependency order.",
  },
  {
    key: "POST_ANALYSIS",
    order: 6,
    label: "Post Analysis",
    description: "Analytical archive và safe retention sau critical analytical path.",
  },
  {
    key: "COMPLETE",
    order: 7,
    label: "Complete",
    description: "Đóng parent EOD run với exact coverage và terminal status.",
  },
] as const

export type QeoIndexEodBusinessPhaseKey = (typeof QEOINDEX_EOD_BUSINESS_PHASES)[number]["key"]

export const QEOINDEX_EOD_PHASES = [
  {
    key: "KFSP_RATING_REFRESH",
    order: 1,
    businessPhase: "DATA_REFRESH",
    label: "KFSP Rating Refresh",
    description: "Refresh KFSP Rating cho đúng phiên EOD rồi freeze exact canonical universe run trước các evidence downstream.",
  },
  {
    key: "TTAI_REFRESH",
    order: 2,
    businessPhase: "DATA_REFRESH",
    label: "TTAI Refresh",
    description: "Refresh TTAI theo frozen canonical universe; partial ticker failures được ghi degraded thay vì giả success.",
  },
  {
    key: "MARKET_CLOSE_COLLECT",
    order: 3,
    businessPhase: "DATA_REFRESH",
    label: "Market Close Collect",
    description: "Thu thập snapshot thị trường sau đóng cửa trên frozen canonical universe và publish market read model cùng phiên.",
  },
  {
    key: "EOD_READY",
    order: 4,
    businessPhase: "READY_GATE",
    label: "EOD Ready",
    description: "Xác nhận frozen canonical Top Stocks universe và toàn bộ evidence EOD cùng phiên đã sẵn sàng.",
  },
  {
    key: "HISTORY_REFRESH",
    order: 5,
    businessPhase: "HISTORY_PREPARE",
    label: "History Refresh",
    description: "Refresh/backfill raw OHLCV 1D cho toàn bộ canonical universe theo bounded window; 1W được derive từ 1D.",
  },
  {
    key: "WYCKOFF_BUILD",
    order: 6,
    businessPhase: "WYCKOFF_PUBLISH",
    label: "Wyckoff Build",
    description: "Build Wyckoff 1D/1W; số snapshot kỳ vọng luôn bằng universeCount × 2.",
  },
  {
    key: "SUPABASE_VALIDATE",
    order: 7,
    businessPhase: "WYCKOFF_PUBLISH",
    label: "Supabase Validate",
    description: "Validate exact canonical membership, snapshot contract và deterministic validation hash trước publish.",
  },
  {
    key: "SUPABASE_PUBLISH",
    order: 8,
    businessPhase: "WYCKOFF_PUBLISH",
    label: "Supabase Publish",
    description: "Publish Wyckoff operational facts trực tiếp vào Supabase; Notion không nằm trên critical path.",
  },
  {
    key: "AI_COUNCIL_DETERMINISTIC",
    order: 9,
    businessPhase: "AI_COUNCIL",
    label: "AI Council Deterministic",
    description: "Chạy deterministic Council trên exact frozen membership sau khi Supabase Wyckoff publish thành công.",
  },
  {
    key: "MARKET_SYNTHESIS",
    order: 10,
    businessPhase: "AI_COUNCIL",
    label: "Market Synthesis",
    description: "Dispatch market-level AI synthesis sau deterministic Council và trước LLM debate.",
  },
  {
    key: "AI_COUNCIL_LLM",
    order: 11,
    businessPhase: "AI_COUNCIL",
    label: "AI Council LLM",
    description: "Chạy LLM debate trên subset được policy chọn sau khi market context đã được dispatch.",
  },
  {
    key: "NOTION_ARCHIVE",
    order: 12,
    businessPhase: "POST_ANALYSIS",
    label: "Notion Archive",
    description: "Archive analytical/audit output và canonical universe history sang Notion sau publication.",
  },
  {
    key: "DRIVE_ARCHIVE",
    order: 13,
    businessPhase: "POST_ANALYSIS",
    label: "Drive Archive",
    description: "Legacy EOD v3 archive checkpoint; QEO-57 sẽ loại khỏi active EOD v4 critical path.",
  },
  {
    key: "RETENTION_CLEANUP",
    order: 14,
    businessPhase: "POST_ANALYSIS",
    label: "Retention Cleanup",
    description: "Prune safe telemetry/staging theo retention policy; raw Daily retention vẫn fail-closed cho tới storage cutover.",
  },
  {
    key: "COMPLETE",
    order: 15,
    businessPhase: "COMPLETE",
    label: "Complete",
    description: "Đóng parent EOD run và ghi summary của refresh, publication, Council, archive và retention.",
  },
] as const

export type QeoIndexEodPhaseKey = (typeof QEOINDEX_EOD_PHASES)[number]["key"]

export const QEOINDEX_EOD_INTERNAL_PHASE_TO_BUSINESS: Readonly<Record<QeoIndexEodPhaseKey, QeoIndexEodBusinessPhaseKey>> = Object.freeze(
  Object.fromEntries(QEOINDEX_EOD_PHASES.map((phase) => [phase.key, phase.businessPhase])) as Record<QeoIndexEodPhaseKey, QeoIndexEodBusinessPhaseKey>,
)

export type StoredJobPhaseStatus = "queued" | "running" | "succeeded" | "failed" | "skipped"
export type AdminJobPhaseStatus = StoredJobPhaseStatus | "pending"

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

const STORED_PHASE_STATUSES = new Set<StoredJobPhaseStatus>(["queued", "running", "succeeded", "failed", "skipped"])

function normalizePhaseStatus(value: string | undefined): AdminJobPhaseStatus {
  if (!value) return "pending"
  const normalized = value.toLowerCase() as StoredJobPhaseStatus
  return STORED_PHASE_STATUSES.has(normalized) ? normalized : "pending"
}

function rowTimestamp(row: SystemJobPhaseRow) {
  return row.finished_at || row.started_at || row.created_at || ""
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
