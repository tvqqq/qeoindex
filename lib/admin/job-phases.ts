export const QEOINDEX_EOD_JOB_KEY = "qeoindex.eod_pipeline" as const

export const QEOINDEX_EOD_PHASES = [
  {
    key: "EOD_READY",
    order: 1,
    label: "EOD Ready",
    description: "Xác nhận phiên EOD đã hoàn tất và upstream market data đủ điều kiện để chạy pipeline.",
  },
  {
    key: "MARKET_CLOSE_COLLECT",
    order: 2,
    label: "Market Close Collect",
    description: "Thu thập snapshot dữ liệu thị trường sau phiên đóng cửa (chỉ số, độ rộng, MA, dòng tiền, ngành) và publish vào read model.",
  },
  {
    key: "HISTORY_REFRESH",
    order: 3,
    label: "History Refresh",
    description: "Refresh/backfill OHLCV cần thiết cho 100 ticker trước khi build các timeframe Wyckoff.",
  },
  {
    key: "WYCKOFF_BUILD",
    order: 4,
    label: "Wyckoff Build",
    description: "Build 1H/4H/1D/1W/1M và tạo đúng 500 Snapshot Keys theo contract.",
  },
  {
    key: "NOTION_STAGING",
    order: 5,
    label: "Notion Staging",
    description: "Upsert snapshot vào Notion unified staging với Run trạng thái Writing.",
  },
  {
    key: "NOTION_VALIDATE",
    order: 6,
    label: "Notion Validate",
    description: "Validate đủ 100 ticker × 5 timeframe, JSON/probability/provider/version và chuyển Run sang Ready.",
  },
  {
    key: "INGEST",
    order: 7,
    label: "Ingest",
    description: "Claim Ready → Ingesting và đọc lại toàn bộ snapshot đã staging.",
  },
  {
    key: "SUPABASE_PUBLISH",
    order: 8,
    label: "Supabase Publish",
    description: "Publish operational Wyckoff facts vào Supabase và hoàn tất Notion Run thành Ingested.",
  },
  {
    key: "AI_COUNCIL_DETERMINISTIC",
    order: 9,
    label: "AI Council Deterministic",
    description: "Chạy deterministic Council trên evidence cùng phiên sau khi Wyckoff publish thành công.",
  },
  {
    key: "AI_COUNCIL_LLM",
    order: 10,
    label: "AI Council LLM",
    description: "Chạy LLM debate chọn lọc sau khi deterministic Council đạt freshness gate.",
  },
  {
    key: "COMPLETE",
    order: 11,
    label: "Complete",
    description: "Đóng pipeline run và ghi kết quả tổng hợp cuối cùng.",
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

const STORED_PHASE_STATUSES = new Set<StoredJobPhaseStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
])

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
    if (!current || rowTimestamp(row) >= rowTimestamp(current)) {
      latestByKey.set(row.phase_key, row)
    }
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
