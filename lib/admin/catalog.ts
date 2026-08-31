import type {
  AdminEnvironmentItem,
  AdminJobDefinition,
  AdminSettingDefinition,
  AdminValidationResult,
} from "./types.ts"

const TICKER_PATTERN = /^[A-Z0-9]{2,12}$/

function parseTickerList(value: unknown): string[] | null {
  let list: string[] = []
  if (Array.isArray(value)) {
    list = value.map((item) => String(item).trim().toUpperCase())
  } else if (typeof value === "string") {
    list = value
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  } else {
    return null
  }

  const unique = [...new Set(list.filter((t) => TICKER_PATTERN.test(t)))]
  if (unique.length > 100) {
    return null
  }
  return unique
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  return null
}

function parseInteger(value: unknown, min: number, max: number): number | null {
  const num = typeof value === "number" ? value : Number(value)
  if (Number.isInteger(num) && num >= min && num <= max) {
    return num
  }
  return null
}

export const ADMIN_SETTING_CATALOG: AdminSettingDefinition[] = [
  // --- Editable Runtime Settings (7) ---
  {
    key: "admin.refresh_interval_seconds",
    group: "system",
    label: "Admin Refresh Interval",
    description: "Chu kỳ làm mới dữ liệu trang Admin (giây). Giới hạn 15 - 300 giây.",
    type: "integer",
    source: "runtime",
    defaultValue: 30,
    editable: true,
    sensitivity: "public",
    impact: "low",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseInteger(val, 15, 300)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Khoảng thời gian phải là số nguyên từ 15 đến 300 giây" }
    },
  },
  {
    key: "admin.job_history_limit",
    group: "system",
    label: "Admin Job History Limit",
    description: "Số lượng bản ghi lịch sử chạy job tối đa hiển thị (20 - 200).",
    type: "integer",
    source: "runtime",
    defaultValue: 50,
    editable: true,
    sensitivity: "public",
    impact: "low",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseInteger(val, 20, 200)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Giới hạn lịch sử job phải là số nguyên từ 20 đến 200 giây" }
    },
  },
  {
    key: "scanner.manual_run_limit",
    group: "scanner",
    label: "Scanner Manual Run Limit",
    description: "Số lượng cổ phiếu quét tối đa cho mỗi lượt chạy scanner thủ công (1 - 100).",
    type: "integer",
    source: "runtime",
    defaultValue: 100,
    editable: true,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseInteger(val, 1, 100)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Giới hạn scanner thủ công phải từ 1 đến 100" }
    },
  },
  {
    key: "ai_council.llm_enabled",
    group: "ai_council",
    label: "AI Council LLM Enabled",
    description: "Bật/tắt chạy LLM multi-agent debate cho AI Council.",
    type: "boolean",
    source: "runtime",
    envKey: "AI_COUNCIL_LLM_ENABLED",
    defaultValue: true,
    editable: true,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseBoolean(val)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Giá trị phải là boolean (true/false)" }
    },
  },
  {
    key: "ai_council.llm_max_tickers",
    group: "ai_council",
    label: "AI Council LLM Max Tickers",
    description: "Số lượng mã tối đa AI Council tranh biện LLM mỗi ngày (1 - 6 mã).",
    type: "integer",
    source: "runtime",
    envKey: "AI_COUNCIL_LLM_MAX_TICKERS",
    defaultValue: 3,
    editable: true,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseInteger(val, 1, 6)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Số mã LLM debate tối đa phải từ 1 đến 6" }
    },
  },
  {
    key: "ai_council.llm_tickers",
    group: "ai_council",
    label: "AI Council LLM Watchlist",
    description: "Danh sách mã ưu tiên debate LLM mỗi ngày (tối đa 100 mã). Phân cách bằng dấu phẩy.",
    type: "ticker_list",
    source: "runtime",
    envKey: "AI_COUNCIL_LLM_TICKERS",
    defaultValue: [],
    editable: true,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseTickerList(val)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Danh sách mã không hợp lệ hoặc vượt quá 100 mã" }
    },
  },
  {
    key: "ai_council.research_tickers",
    group: "ai_council",
    label: "AI Council Curated Research Tickers",
    description: "Danh sách mã tổng hợp ngữ cảnh Notion Research cho AI Council (tối đa 100 mã).",
    type: "ticker_list",
    source: "runtime",
    envKey: "AI_COUNCIL_RESEARCH_TICKERS",
    defaultValue: ["MSN"],
    editable: true,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: false,
    validate(val: unknown): AdminValidationResult {
      const parsed = parseTickerList(val)
      return parsed !== null
        ? { ok: true, value: parsed }
        : { ok: false, error: "Danh sách mã nghiên cứu không hợp lệ hoặc vượt quá 100 mã" }
    },
  },

  // --- Read-Only Code/Safety Contracts ---
  {
    key: "market.universe_size",
    group: "market",
    label: "Wyckoff Universe Size",
    description: "Quy mô danh mục Top 100 Wyckoff canonical an toàn.",
    type: "integer",
    source: "code",
    defaultValue: 100,
    editable: false,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "scanner.min_bars_complete",
    group: "scanner",
    label: "Scanner Complete Bar Threshold",
    description: "Số nến ngày tối thiểu để scanner đánh giá Complete.",
    type: "integer",
    source: "code",
    defaultValue: 200,
    editable: false,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "scanner.min_bars_incomplete",
    group: "scanner",
    label: "Scanner Incomplete Bar Threshold",
    description: "Số nến ngày tối thiểu để scanner chấp nhận Incomplete LOW.",
    type: "integer",
    source: "code",
    defaultValue: 60,
    editable: false,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "wyckoff.required_snapshots",
    group: "wyckoff",
    label: "Wyckoff Required Snapshots",
    description: "Số lượng snapshot cần có đủ trong một đợt ingest Wyckoff.",
    type: "integer",
    source: "code",
    defaultValue: 500,
    editable: false,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "provider.concurrency_max",
    group: "provider",
    label: "DNSE Provider Concurrency Limit",
    description: "Giới hạn số request song song tối đa gửi đến nhà cung cấp DNSE.",
    type: "integer",
    source: "code",
    defaultValue: 12,
    editable: false,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "provider.notion_timeout_ms",
    group: "provider",
    label: "Notion API Timeout",
    description: "Thời gian chờ tối đa cho request Notion (ms).",
    type: "integer",
    source: "code",
    defaultValue: 10000,
    editable: false,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "provider.openai_timeout_ms",
    group: "provider",
    label: "OpenAI API Timeout",
    description: "Thời gian chờ tối đa cho request OpenAI (ms).",
    type: "integer",
    source: "code",
    defaultValue: 25000,
    editable: false,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "market.session_schedule",
    group: "market",
    label: "HOSE Trading Session Schedule",
    description: "Khung giờ giao dịch khớp lệnh HOSE (09:00 - 15:00 ICT).",
    type: "string",
    source: "code",
    defaultValue: "09:00 - 15:00 ICT (T2-T6)",
    editable: false,
    sensitivity: "public",
    impact: "high",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
  {
    key: "cache.namespace_version",
    group: "cache",
    label: "Cache Namespace Prefix",
    description: "Tiền tố khóa cache trên Vercel Runtime Cache và Upstash Redis.",
    type: "string",
    source: "code",
    defaultValue: "qeoindex:v2",
    editable: false,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: true,
    validate: () => ({ ok: false, error: "Read-only safety contract" }),
  },
]

export function getAdminSettingDefinition(key: string): AdminSettingDefinition | undefined {
  return ADMIN_SETTING_CATALOG.find((s) => s.key === key)
}

export function validateAdminSetting(key: string, value: unknown): AdminValidationResult {
  const definition = getAdminSettingDefinition(key)
  if (!definition) {
    return { ok: false, error: `Cài đặt không tồn tại trong danh mục: ${key}` }
  }
  if (!definition.editable) {
    return { ok: false, error: `Cài đặt ${key} là chỉ đọc và không thể thay đổi tại runtime` }
  }
  return definition.validate(value)
}

export const ADMIN_JOB_CATALOG: AdminJobDefinition[] = [
  {
    key: "qeoindex.eod_pipeline",
    provider: "supabase_pg_cron",
    label: "QeoIndex Unified EOD Pipeline",
    description: "Unified EOD chain: market readiness → OHLCV refresh → Wyckoff v2 → Notion staging/validation → Supabase publish → AI Council.",
    group: "system",
    scheduleUtc: "15 8 * * 1-5",
    scheduleIct: "15:15 T2-T6",
    scheduleKind: "workflow",
    schedulerName: "qeoindex-eod-pipeline-1515-ict",
    scheduleDays: "weekdays",
    dependencies: [
      "EOD_READY",
      "HISTORY_REFRESH",
      "WYCKOFF_BUILD",
      "NOTION_STAGING",
      "NOTION_VALIDATE",
      "INGEST",
      "SUPABASE_PUBLISH",
      "AI_COUNCIL_DETERMINISTIC",
      "AI_COUNCIL_LLM",
      "COMPLETE",
    ],
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 90,
  },
  {
    key: "signals.daily",
    provider: "vercel_cron_workflow",
    label: "Daily Signals Workflow",
    description: "Workflow tính toán tín hiệu kỹ thuật cuối ngày và cập nhật khuyến nghị.",
    group: "signals",
    scheduleUtc: "0 0 * * 1-5",
    scheduleIct: "07:00 T2-T6",
    scheduleKind: "workflow",
    scheduleDays: "weekdays",
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 28 * 60,
    maxDurationMinutes: 30,
  },
  {
    key: "wyckoff.ingest",
    provider: "vercel_cron",
    label: "Wyckoff Snapshot Ingest (Legacy)",
    description: "Nhập 500 snapshot phân tích Wyckoff từ Notion staging vào Supabase.",
    group: "wyckoff",
    scheduleUtc: "0 10 * * 1-5",
    scheduleIct: "17:00 T2-T6",
    scheduleKind: "point",
    scheduleDays: "weekdays",
    evidenceSource: "system_job_runs",
    manualPolicy: "confirm",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "ai_council.daily",
    provider: "vercel_cron",
    label: "AI Council Daily Synthesis (Legacy)",
    description: "Tổng hợp đánh giá AI Council hàng ngày từ các mô hình định lượng.",
    group: "ai_council",
    scheduleUtc: "15 10 * * 1-5",
    scheduleIct: "17:15 T2-T6",
    scheduleKind: "point",
    scheduleDays: "weekdays",
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "ai_council.debate_daily",
    provider: "vercel_cron",
    label: "AI Council LLM Debate (Legacy)",
    description: "Thực hiện tranh biện đa tác tử LLM cho các mã cổ phiếu chọn lọc.",
    group: "ai_council",
    scheduleUtc: "25 10 * * 1-5",
    scheduleIct: "17:25 T2-T6",
    scheduleKind: "point",
    scheduleDays: "weekdays",
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 15,
  },
  {
    key: "market.sync_5m",
    provider: "supabase_pg_cron",
    label: "Market 5-Minute Sync",
    description: "Đồng bộ nến giá 5 phút và sổ lệnh trong phiên giao dịch.",
    group: "market",
    scheduleUtc: "*/5 2-6 * * 1-5; 0-40/5 7 * * 1-5",
    scheduleIct: "Mỗi 5p (09:00-14:40 T2-T6)",
    scheduleKind: "interval",
    schedulerName: "sync-universe-5m",
    scheduleDays: "weekdays",
    windowStartIct: "09:00",
    windowEndIct: "14:40",
    intervalMinutes: 5,
    evidenceSource: "stock_orderbook_snapshots",
    manualPolicy: "disabled",
    freshnessMinutes: 15,
    maxDurationMinutes: 5,
  },
  {
    key: "market.sync_eod",
    provider: "supabase_pg_cron",
    label: "Market EOD Sync",
    description: "Đồng bộ snapshot giá đóng cửa thị trường.",
    group: "market",
    scheduleUtc: "45 7 * * 1-5",
    scheduleIct: "14:45 T2-T6",
    scheduleKind: "point",
    schedulerName: "sync-universe-eod-1445",
    scheduleDays: "weekdays",
    windowStartIct: "14:45",
    windowEndIct: "14:45",
    evidenceSource: "stock_orderbook_snapshots",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "kfsp.rating_daily",
    provider: "supabase_pg_cron",
    label: "KFSP Rating Daily Sync",
    description: "Đồng bộ dữ liệu xếp hạng cổ phiếu KFSP lúc 07:00 ICT.",
    group: "provider",
    scheduleUtc: "0 0 * * *",
    scheduleIct: "07:00 hàng ngày",
    scheduleKind: "point",
    schedulerName: "kfsp-rating-daily-7am-ict",
    scheduleDays: "daily",
    evidenceSource: "kfsp_rating_sync_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 15,
  },
  {
    key: "kfsp.ttai_history",
    provider: "supabase_pg_cron",
    label: "KFSP TTAI History Daily",
    description: "Kiểm tra và cập nhật lịch sử TTAI lúc 07:10 ICT khi kỳ báo cáo tài chính thay đổi.",
    group: "provider",
    scheduleUtc: "10 0 * * *",
    scheduleIct: "07:10 hàng ngày",
    scheduleKind: "point",
    schedulerName: "kfsp-ttai-history-daily-0710-ict",
    scheduleDays: "daily",
    evidenceSource: "kfsp_ttai_sync_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "scanner.run",
    provider: "machine",
    label: "Manual Scanner Run",
    description: "Chạy engine quét mẫu hình và xu hướng cổ phiếu với giới hạn mã chỉ định.",
    group: "scanner",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "allowed",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "signals.monitor",
    provider: "machine",
    label: "Signals Health Monitor",
    description: "Kiểm tra tình trạng dữ liệu và hoạt động của engine tín hiệu.",
    group: "signals",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "confirm",
    freshnessMinutes: 60,
    maxDurationMinutes: 5,
  },
  {
    key: "market.sync_universe",
    provider: "machine",
    label: "Market Universe Sync",
    description: "Đồng bộ toàn bộ danh mục Top 100 cổ phiếu và chỉ số thị trường.",
    group: "market",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "confirm",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 5,
  },
  {
    key: "market.cache_invalidate",
    provider: "machine",
    label: "Market Cache Invalidation",
    description: "Xóa toàn bộ cache thị trường (Thao tác phá hủy, bị vô hiệu hóa thủ công).",
    group: "cache",
    scheduleKind: "manual",
    evidenceSource: "none",
    manualPolicy: "disabled",
    freshnessMinutes: 24 * 60,
    maxDurationMinutes: 5,
  },
  {
    key: "wyckoff.run",
    provider: "machine",
    label: "Wyckoff Engine Execution",
    description: "Tính toán lại cấu trúc Wyckoff (Vô hiệu hóa thủ công để tránh xung đột Notion).",
    group: "wyckoff",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 15,
  },
]

export function getAdminJobDefinition(key: string): AdminJobDefinition | undefined {
  return ADMIN_JOB_CATALOG.find((j) => j.key === key)
}

export const ADMIN_ENVIRONMENT_INVENTORY: AdminEnvironmentItem[] = [
  // Notion
  { key: "NOTION_API_KEY", group: "provider", label: "Notion API Key", description: "API Key chính xác thực với Notion workspace", sensitivity: "secret", isConfigured: false },
  { key: "NOTION_TOKEN", group: "provider", label: "Notion Token (Legacy Alias)", description: "Alias cũ của NOTION_API_KEY", sensitivity: "secret", isConfigured: false },
  { key: "NOTION_STOCK_THESIS_DATA_SOURCE_ID", group: "provider", label: "Notion Stock Thesis DB ID", description: "Data source ID cho luận điểm đầu tư", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_RESEARCH_SOURCES_DATA_SOURCE_ID", group: "provider", label: "Notion Research Sources DB ID", description: "Data source ID cho tài liệu nghiên cứu", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_ANALYSIS_LOG_DATA_SOURCE_ID", group: "provider", label: "Notion Analysis Log DB ID", description: "Data source ID cho nhật ký phân tích", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_WYCKOFF_UNIVERSE_DATA_SOURCE_ID", group: "provider", label: "Notion Wyckoff Universe DB ID", description: "Data source ID cho danh mục Wyckoff", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_WYCKOFF_RUNS_DATA_SOURCE_ID", group: "provider", label: "Notion Wyckoff Runs DB ID", description: "Data source ID cho đợt chạy Wyckoff", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_WYCKOFF_SNAPSHOTS_DATA_SOURCE_ID", group: "provider", label: "Notion Wyckoff Snapshots DB ID", description: "Data source ID cho snapshot phân tích", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_DAILY_WYCKOFF_SCAN_DATA_SOURCE_ID", group: "provider", label: "Notion Daily Wyckoff Scan DB ID", description: "Data source ID cho kết quả quét hàng ngày", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_TRADE_RECOMMENDATIONS_DATA_SOURCE_ID", group: "provider", label: "Notion Trade Recs DB ID", description: "Data source ID cho khuyến nghị giao dịch", sensitivity: "internal", isConfigured: false },
  { key: "NOTION_SIGNAL_EVENTS_DATA_SOURCE_ID", group: "provider", label: "Notion Signal Events DB ID", description: "Data source ID cho sự kiện tín hiệu", sensitivity: "internal", isConfigured: false },

  // Finhay
  { key: "FINHAY_MCP_URL", group: "integration", label: "Finhay MCP URL", description: "Địa chỉ endpoint Finhay Model Context Protocol", sensitivity: "internal", isConfigured: false },
  { key: "FINHAY_OAUTH_CLIENT_ID", group: "integration", label: "Finhay OAuth Client ID", description: "Client ID cho OAuth Finhay", sensitivity: "internal", isConfigured: false },
  { key: "FINHAY_OAUTH_CLIENT_SECRET", group: "integration", label: "Finhay OAuth Client Secret", description: "Client Secret bảo mật cho OAuth Finhay", sensitivity: "secret", isConfigured: false },
  { key: "FINHAY_OAUTH_SCOPE", group: "integration", label: "Finhay OAuth Scope", description: "Phạm vi quyền OAuth yêu cầu", sensitivity: "internal", isConfigured: false },

  // DNSE
  { key: "DNSE_API_KEY", group: "provider", label: "DNSE API Key", description: "API Key xác thực DNSE Open API", sensitivity: "secret", isConfigured: false },
  { key: "DNSE_API_SECRET", group: "provider", label: "DNSE API Secret", description: "API Secret xác thực DNSE Open API", sensitivity: "secret", isConfigured: false },
  { key: "DNSE_API_BASE_URL", group: "provider", label: "DNSE REST Base URL", description: "Địa chỉ máy chủ REST API của DNSE", sensitivity: "internal", isConfigured: false },
  { key: "DNSE_WS_URL", group: "provider", label: "DNSE WebSocket URL", description: "Địa chỉ WebSocket realtime của DNSE", sensitivity: "internal", isConfigured: false },

  // Redis
  { key: "UPSTASH_REDIS_REST_URL", group: "cache", label: "Upstash Redis REST URL", description: "Địa chỉ kết nối REST tới Upstash Redis L2 cache", sensitivity: "internal", isConfigured: false },
  { key: "UPSTASH_REDIS_REST_TOKEN", group: "cache", label: "Upstash Redis REST Token", description: "Token xác thực Upstash Redis L2 cache", sensitivity: "secret", isConfigured: false },

  // Supabase
  { key: "NEXT_PUBLIC_SUPABASE_URL", group: "system", label: "Supabase Public URL", description: "URL công khai của Supabase project", sensitivity: "public", isConfigured: false },
  { key: "SUPABASE_URL", group: "system", label: "Supabase URL (Server fallback)", description: "URL server-side của Supabase project", sensitivity: "public", isConfigured: false },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", group: "system", label: "Supabase Anon Key", description: "Khóa công khai anon của Supabase", sensitivity: "public", isConfigured: false },
  { key: "SUPABASE_SERVICE_ROLE_KEY", group: "system", label: "Supabase Service Role Key", description: "Khóa dịch vụ service role của Supabase (Server-only)", sensitivity: "secret", isConfigured: false },

  // KFSP
  { key: "KFSP_USERNAME", group: "provider", label: "KFSP Username", description: "Tài khoản đồng bộ dữ liệu KFSP", sensitivity: "secret", isConfigured: false },
  { key: "KFSP_PASSWORD", group: "provider", label: "KFSP Password", description: "Mật khẩu đồng bộ dữ liệu KFSP", sensitivity: "secret", isConfigured: false },
  { key: "KFSP_SYNC_SECRET", group: "provider", label: "KFSP Sync Secret", description: "Khóa bí mật đồng bộ KFSP Edge Function", sensitivity: "secret", isConfigured: false },
  { key: "KFSP_MINIMUM_ROWS", group: "provider", label: "KFSP Minimum Rows Threshold", description: "Số dòng tối thiểu hợp lệ khi đồng bộ KFSP", sensitivity: "internal", isConfigured: false },

  // Machine secrets
  { key: "SCANNER_RUN_SECRET", group: "scanner", label: "Scanner Run Secret", description: "Bearer secret kích hoạt chạy scanner", sensitivity: "secret", isConfigured: false },
  { key: "SIGNAL_MONITOR_SECRET", group: "signals", label: "Signal Monitor Secret", description: "Bearer secret giám sát tín hiệu", sensitivity: "secret", isConfigured: false },
  { key: "AI_COUNCIL_RUN_SECRET", group: "ai_council", label: "AI Council Run Secret", description: "Bearer secret chạy AI Council", sensitivity: "secret", isConfigured: false },
  { key: "MARKET_SYNC_SECRET", group: "market", label: "Market Sync Secret", description: "Bearer secret đồng bộ dữ liệu thị trường", sensitivity: "secret", isConfigured: false },
  { key: "MARKET_CACHE_ADMIN_SECRET", group: "cache", label: "Market Cache Admin Secret", description: "Bearer secret xóa cache thị trường", sensitivity: "secret", isConfigured: false },
  { key: "CRON_SECRET", group: "system", label: "Vercel Cron Secret", description: "Bearer secret Vercel Cron xác thực endpoint", sensitivity: "secret", isConfigured: false },

  // AI Council
  { key: "OPENAI_API_KEY", group: "ai_council", label: "OpenAI API Key", description: "Khóa API OpenAI dùng cho AI Council debate", sensitivity: "secret", isConfigured: false },
  { key: "AI_COUNCIL_LLM_ENABLED", group: "ai_council", label: "AI Council LLM Enabled (Env)", description: "Bật/tắt LLM AI Council từ môi trường", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_BULL_MODEL", group: "ai_council", label: "AI Council Bull Agent Model", description: "Mô hình LLM cho tác tử Bull", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_BEAR_MODEL", group: "ai_council", label: "AI Council Bear Agent Model", description: "Mô hình LLM cho tác tử Bear", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_RISK_MODEL", group: "ai_council", label: "AI Council Risk Agent Model", description: "Mô hình LLM cho tác tử Risk", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_CHAIR_MODEL", group: "ai_council", label: "AI Council Chair Agent Model", description: "Mô hình LLM cho tác tử Chair", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_ESCALATION_MODEL", group: "ai_council", label: "AI Council Escalation Model", description: "Mô hình LLM cho trường hợp cần leo thang phân tích", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_FALLBACK_MODEL", group: "ai_council", label: "AI Council Fallback Model", description: "Mô hình LLM dự phòng khi mô hình chính gặp sự cố", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_BULL_EFFORT", group: "ai_council", label: "AI Council Bull Effort", description: "Mức độ suy luận cho Bull agent (low/medium/high)", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_BEAR_EFFORT", group: "ai_council", label: "AI Council Bear Effort", description: "Mức độ suy luận cho Bear agent (low/medium/high)", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_RISK_EFFORT", group: "ai_council", label: "AI Council Risk Effort", description: "Mức độ suy luận cho Risk agent (low/medium/high)", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_CHAIR_EFFORT", group: "ai_council", label: "AI Council Chair Effort", description: "Mức độ suy luận cho Chair agent (low/medium/high)", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_ESCALATION_EFFORT", group: "ai_council", label: "AI Council Escalation Effort", description: "Mức độ suy luận khi leo thang", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_MAX_TICKERS", group: "ai_council", label: "AI Council Max Tickers (Env)", description: "Số mã LLM debate tối đa từ môi trường", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_LLM_TICKERS", group: "ai_council", label: "AI Council LLM Tickers (Env)", description: "Danh sách mã debate từ môi trường", sensitivity: "internal", isConfigured: false },
  { key: "AI_COUNCIL_RESEARCH_TICKERS", group: "ai_council", label: "AI Council Research Tickers (Env)", description: "Danh sách mã nghiên cứu từ môi trường", sensitivity: "internal", isConfigured: false },

  // Slack
  { key: "SLACK_CONNECTOR", group: "integration", label: "Slack Connector Slug", description: "Slug định danh Vercel Connect Slack", sensitivity: "internal", isConfigured: false },
  { key: "SLACK_ALERT_CHANNEL", group: "integration", label: "Slack Alert Channel Name", description: "Tên kênh Slack nhận cảnh báo", sensitivity: "internal", isConfigured: false },
  { key: "SLACK_ALERT_CHANNEL_ID", group: "integration", label: "Slack Alert Channel ID", description: "ID kênh Slack cố định", sensitivity: "internal", isConfigured: false },

  // Root Admin & App URL
  { key: "ROOT_ADMIN_USER_IDS", group: "system", label: "Root Admin Allowlist", description: "Danh sách UUID người dùng có quyền Root Admin", sensitivity: "secret", isConfigured: false },
  { key: "APP_URL", group: "system", label: "Canonical Application URL", description: "URL gốc chính thức của ứng dụng", sensitivity: "public", isConfigured: false },
  { key: "NEXT_PUBLIC_APP_URL", group: "system", label: "Next.js Public App URL", description: "URL công khai của ứng dụng", sensitivity: "public", isConfigured: false },
  { key: "QSTASH_TOKEN", group: "system", label: "Upstash QStash Token", description: "Token xác thực QStash hàng đợi", sensitivity: "secret", isConfigured: false },

  // Build & Deployment Metadata
  { key: "NODE_ENV", group: "system", label: "Node Environment", description: "Môi trường thực thi Node.js (development/production)", sensitivity: "public", isConfigured: false },
  { key: "VERCEL_ENV", group: "system", label: "Vercel Environment", description: "Môi trường Vercel (production/preview/development)", sensitivity: "public", isConfigured: false },
  { key: "VERCEL_URL", group: "system", label: "Vercel Deployment URL", description: "URL bản triển khai tự động của Vercel", sensitivity: "public", isConfigured: false },
  { key: "VERCEL_PROJECT_PRODUCTION_URL", group: "system", label: "Vercel Production Domain", description: "Tên miền chính thức của dự án trên Vercel", sensitivity: "public", isConfigured: false },
  { key: "VERCEL_GIT_COMMIT_SHA", group: "system", label: "Vercel Git Commit SHA", description: "Mã commit Git của bản build Vercel", sensitivity: "public", isConfigured: false },
  { key: "VERCEL_GIT_PREVIOUS_SHA", group: "system", label: "Vercel Git Previous SHA", description: "Mã commit Git trước đó", sensitivity: "public", isConfigured: false },
  { key: "NEXT_PUBLIC_GIT_COMMIT_SHA", group: "system", label: "Public Git Commit SHA", description: "Mã commit công khai hiển thị trên UI", sensitivity: "public", isConfigured: false },
  { key: "NEXT_PUBLIC_GIT_COMMIT_DATE", group: "system", label: "Public Git Commit Date", description: "Ngày commit công khai hiển thị trên UI", sensitivity: "public", isConfigured: false },
  { key: "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", group: "system", label: "Public Vercel Commit SHA", description: "Mã commit Vercel công khai", sensitivity: "public", isConfigured: false },
]

export function getAdminEnvironmentInventory(env: Record<string, string | undefined> = process.env): AdminEnvironmentItem[] {
  return ADMIN_ENVIRONMENT_INVENTORY.map((item) => {
    const rawVal = env[item.key]
    const isConfigured = rawVal !== undefined && rawVal !== ""
    return {
      ...item,
      isConfigured,
      value: item.sensitivity === "secret" ? undefined : (isConfigured ? rawVal : undefined),
    }
  })
}
