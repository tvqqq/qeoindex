export const QEOINDEX_EOD_JOB_KEY = "qeoindex.eod_pipeline" as const

export const QEOINDEX_EOD_PHASES = [
  {
    key: "EOD_READY",
    order: 1,
    label: "EOD Ready",
    description: "Xác nhận canonical Top Stocks universe và toàn bộ evidence EOD cùng phiên đã sẵn sàng.",
  },
  {
    key: "MARKET_CLOSE_COLLECT",
    order: 2,
    label: "Market Close Collect",
    description: "Thu thập snapshot thị trường sau đóng cửa và publish market read model cùng phiên.",
  },
  {
    key: "HISTORY_REFRESH",
    order: 3,
    label: "History Refresh",
    description: "Refresh/backfill raw OHLCV 1D cho toàn bộ canonical universe theo batch giới hạn; 1W được derive từ 1D.",
  },
  {
    key: "WYCKOFF_BUILD",
    order: 4,
    label: "Wyckoff Build",
    description: "Build Wyckoff 1D/1W; số snapshot kỳ vọng luôn bằng universeCount × 2.",
  },
  {
    key: "SUPABASE_VALIDATE",
    order: 5,
    label: "Supabase Validate",
    description: "Validate exact canonical membership, snapshot contract và deterministic validation hash trước publish.",
  },
  {
    key: "SUPABASE_PUBLISH",
    order: 6,
    label: "Supabase Publish",
    description: "Publish Wyckoff operational facts trực tiếp vào Supabase; Notion không nằm trên critical path.",
  },
  {
    key: "AI_COUNCIL_DETERMINISTIC",
    order: 7,
    label: "AI Council Deterministic",
    description: "Chạy deterministic Council trên exact canonical membership sau khi Supabase Wyckoff publish thành công.",
  },
  {
    key: "AI_COUNCIL_LLM",
    order: 8,
    label: "AI Council LLM",
    description: "Chạy LLM debate trên subset được policy chọn; cost cap độc lập với quy mô canonical universe.",
  },
  {
    key: "MARKET_SYNTHESIS",
    order: 9,
    label: "Market Synthesis",
    description: "Dispatch market-level AI synthesis từ published market evidence; lỗi phase này không đảo ngược Supabase publish.",
  },
  {
    key: "NOTION_ARCHIVE",
    order: 10,
    label: "Notion Archive",
    description: "Archive analytical/audit output và canonical universe history sang Notion sau publication.",
  },
  {
    key: "RETENTION_CLEANUP",
    order: 11,
    label: "Retention Cleanup",
    description: "Prune telemetry/staging/build artifacts an toàn; raw Daily OHLCV tiếp tục được giữ trong Supabase và không phụ thuộc external cold archive.",
  },
  {
    key: "COMPLETE",
    order: 12,
    label: "Complete",
    description: "Đóng parent EOD run và ghi summary của publication, Council, Notion archive và retention.",
  },
] as const

export type QeoIndexEodPhaseKey = (typeof QEOINDEX_EOD_PHASES)[number]["key"]
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
