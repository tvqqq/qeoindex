import type {
  AdminEnvironmentItem,
  AdminJobDefinition,
  AdminSettingDefinition,
  AdminSettingGroup,
  AdminSensitivity,
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

  const unique = [...new Set(list.filter((ticker) => TICKER_PATTERN.test(ticker)))]
  return unique.length <= 100 ? unique : null
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  return null
}

function parseInteger(value: unknown, min: number, max: number): number | null {
  const num = typeof value === "number" ? value : Number(value)
  return Number.isInteger(num) && num >= min && num <= max ? num : null
}

export const ADMIN_SETTING_CATALOG: AdminSettingDefinition[] = [
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
    validate(value): AdminValidationResult {
      const parsed = parseInteger(value, 15, 300)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Khoảng thời gian phải là số nguyên từ 15 đến 300 giây" }
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
    validate(value): AdminValidationResult {
      const parsed = parseInteger(value, 20, 200)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Giới hạn lịch sử job phải là số nguyên từ 20 đến 200" }
    },
  },
  {
    key: "scanner.manual_run_limit",
    group: "scanner",
    label: "Scanner Manual Run Limit",
    description: "Số lượng cổ phiếu quét tối đa cho mỗi lượt scanner thủ công (1 - 200), đồng bộ với canonical universe cap.",
    type: "integer",
    source: "runtime",
    defaultValue: 200,
    editable: true,
    sensitivity: "public",
    impact: "medium",
    requiresDeployment: false,
    validate(value): AdminValidationResult {
      const parsed = parseInteger(value, 1, 200)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Giới hạn scanner thủ công phải từ 1 đến 200" }
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
    validate(value): AdminValidationResult {
      const parsed = parseBoolean(value)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Giá trị phải là boolean (true/false)" }
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
    validate(value): AdminValidationResult {
      const parsed = parseInteger(value, 1, 6)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Số mã LLM debate tối đa phải từ 1 đến 6" }
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
    validate(value): AdminValidationResult {
      const parsed = parseTickerList(value)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Danh sách mã không hợp lệ hoặc vượt quá 100 mã" }
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
    validate(value): AdminValidationResult {
      const parsed = parseTickerList(value)
      return parsed !== null ? { ok: true, value: parsed } : { ok: false, error: "Danh sách mã nghiên cứu không hợp lệ hoặc vượt quá 100 mã" }
    },
  },
  {
    key: "market.universe_size",
    group: "market",
    label: "Canonical Universe Max Size",
    description: "Quy mô tối đa của canonical Top Stocks 200 universe; số thành viên thực tế có thể thấp hơn 200.",
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
    label: "Wyckoff Max Required Snapshots",
    description: "Số snapshot tối đa theo canonical 200 mã × 5 timeframe; số thực tế là universeCount × 5.",
    type: "integer",
    source: "code",
    defaultValue: 1_000,
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
    defaultValue: 10_000,
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
    defaultValue: 25_000,
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
  return ADMIN_SETTING_CATALOG.find((setting) => setting.key === key)
}

export function validateAdminSetting(key: string, value: unknown): AdminValidationResult {
  const definition = getAdminSettingDefinition(key)
  if (!definition) return { ok: false, error: `Cài đặt không tồn tại trong danh mục: ${key}` }
  if (!definition.editable) return { ok: false, error: `Cài đặt ${key} là chỉ đọc và không thể thay đổi tại runtime` }
  return definition.validate(value)
}

export const ADMIN_JOB_CATALOG: AdminJobDefinition[] = [
  {
    key: "qeoindex.eod_pipeline",
    provider: "supabase_pg_cron",
    label: "QeoIndex Unified EOD Pipeline",
    description: "Unified EOD chain: market readiness → OHLCV refresh → Wyckoff → publish → AI Council.",
    group: "system",
    scheduleUtc: "15 8 * * 1-5",
    scheduleIct: "15:15 T2-T6",
    scheduleKind: "workflow",
    schedulerName: "qeoindex-eod-pipeline-1515-ict",
    scheduleDays: "weekdays",
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 90,
  },
  {
    key: "signals.daily",
    provider: "vercel_cron_workflow",
    label: "Daily Signals Workflow",
    description: "Workflow quét toàn bộ canonical universe và theo dõi tín hiệu trong phiên.",
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
    description: "Legacy Notion-staging ingest; effective Admin contract exposes it only as confirmed manual maintenance/recovery.",
    group: "wyckoff",
    scheduleUtc: "0 10 * * 1-5",
    scheduleIct: "17:00 T2-T6",
    scheduleKind: "point",
    scheduleDays: "weekdays",
    evidenceSource: "system_job_runs",
    manualPolicy: "confirm",
    manualPurpose: "maintenance",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "ai_council.daily",
    provider: "vercel_cron",
    label: "AI Council Daily Synthesis (Legacy)",
    description: "Legacy standalone AI Council daily synthesis; canonical EOD pipeline owns current execution.",
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
    description: "Legacy standalone LLM debate; canonical EOD pipeline owns current execution.",
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
    description: "Đồng bộ nến giá 5 phút và sổ lệnh canonical trong phiên giao dịch.",
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
    description: "Đồng bộ snapshot giá/orderbook đóng cửa cho canonical universe.",
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
    description: "Chạy lại scanner trên canonical universe hoặc một phạm vi mã giới hạn để recovery/diagnostic.",
    group: "scanner",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "allowed",
    manualPurpose: "recovery",
    automatedParentKeys: ["signals.daily"],
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 10,
  },
  {
    key: "signals.monitor",
    provider: "machine",
    label: "Signals Health Monitor",
    description: "Chạy lại một lượt monitor tín hiệu khi cần recovery/diagnostic trong phiên.",
    group: "signals",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "confirm",
    manualPurpose: "recovery",
    automatedParentKeys: ["signals.daily"],
    freshnessMinutes: 60,
    maxDurationMinutes: 5,
  },
  {
    key: "market.sync_universe",
    provider: "machine",
    label: "Market Canonical Universe Snapshot Sync",
    description: "Đồng bộ quote/orderbook/foreign-flow snapshot cho current canonical universe (tối đa 200 mã); không chọn membership.",
    group: "market",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "confirm",
    manualPurpose: "recovery",
    automatedParentKeys: ["market.sync_5m", "market.sync_eod"],
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 5,
  },
  {
    key: "market.cache_invalidate",
    provider: "machine",
    label: "Market Cache Invalidation",
    description: "Xóa toàn bộ cache thị trường; destructive action bị vô hiệu hóa trong Control Plane.",
    group: "cache",
    scheduleKind: "manual",
    evidenceSource: "none",
    manualPolicy: "disabled",
    manualPurpose: "maintenance",
    freshnessMinutes: 24 * 60,
    maxDurationMinutes: 5,
  },
  {
    key: "wyckoff.run",
    provider: "machine",
    label: "Wyckoff Engine Execution",
    description: "Legacy direct Wyckoff execution bị vô hiệu hóa để tránh xung đột canonical EOD v3.",
    group: "wyckoff",
    scheduleKind: "manual",
    evidenceSource: "system_job_runs",
    manualPolicy: "disabled",
    manualPurpose: "maintenance",
    freshnessMinutes: 26 * 60,
    maxDurationMinutes: 15,
  },
]

export function getAdminJobDefinition(key: string): AdminJobDefinition | undefined {
  return ADMIN_JOB_CATALOG.find((job) => job.key === key)
}

function environmentItem(
  key: string,
  group: AdminSettingGroup,
  label: string,
  sensitivity: AdminSensitivity,
  description = label,
): AdminEnvironmentItem {
  return { key, group, label, description, sensitivity, isConfigured: false }
}

export const ADMIN_ENVIRONMENT_INVENTORY: AdminEnvironmentItem[] = [
  environmentItem("NOTION_API_KEY", "provider", "Notion API Key", "secret"),
  environmentItem("NOTION_TOKEN", "provider", "Notion Token (Legacy Alias)", "secret"),
  environmentItem("NOTION_STOCK_THESIS_DATA_SOURCE_ID", "provider", "Notion Stock Thesis DB ID", "internal"),
  environmentItem("NOTION_RESEARCH_SOURCES_DATA_SOURCE_ID", "provider", "Notion Research Sources DB ID", "internal"),
  environmentItem("NOTION_ANALYSIS_LOG_DATA_SOURCE_ID", "provider", "Notion Analysis Log DB ID", "internal"),
  environmentItem("NOTION_WYCKOFF_UNIVERSE_DATA_SOURCE_ID", "provider", "Notion Wyckoff Universe DB ID", "internal"),
  environmentItem("NOTION_WYCKOFF_RUNS_DATA_SOURCE_ID", "provider", "Notion Wyckoff Runs DB ID", "internal"),
  environmentItem("NOTION_WYCKOFF_SNAPSHOTS_DATA_SOURCE_ID", "provider", "Notion Wyckoff Snapshots DB ID", "internal"),
  environmentItem("NOTION_DAILY_WYCKOFF_SCAN_DATA_SOURCE_ID", "provider", "Notion Daily Wyckoff Scan DB ID", "internal"),
  environmentItem("NOTION_TRADE_RECOMMENDATIONS_DATA_SOURCE_ID", "provider", "Notion Trade Recs DB ID", "internal"),
  environmentItem("NOTION_SIGNAL_EVENTS_DATA_SOURCE_ID", "provider", "Notion Signal Events DB ID", "internal"),

  environmentItem("FINHAY_MCP_URL", "integration", "Finhay MCP URL", "internal"),
  environmentItem("FINHAY_OAUTH_CLIENT_ID", "integration", "Finhay OAuth Client ID", "internal"),
  environmentItem("FINHAY_OAUTH_CLIENT_SECRET", "integration", "Finhay OAuth Client Secret", "secret"),
  environmentItem("FINHAY_OAUTH_SCOPE", "integration", "Finhay OAuth Scope", "internal"),

  environmentItem("DNSE_API_KEY", "provider", "DNSE API Key", "secret"),
  environmentItem("DNSE_API_SECRET", "provider", "DNSE API Secret", "secret"),
  environmentItem("DNSE_API_BASE_URL", "provider", "DNSE REST Base URL", "internal"),
  environmentItem("DNSE_WS_URL", "provider", "DNSE WebSocket URL", "internal"),

  environmentItem("UPSTASH_REDIS_REST_URL", "cache", "Upstash Redis REST URL", "internal"),
  environmentItem("UPSTASH_REDIS_REST_TOKEN", "cache", "Upstash Redis REST Token", "secret"),

  environmentItem("NEXT_PUBLIC_SUPABASE_URL", "system", "Supabase Public URL", "public"),
  environmentItem("SUPABASE_URL", "system", "Supabase URL (Server fallback)", "public"),
  environmentItem("NEXT_PUBLIC_SUPABASE_ANON_KEY", "system", "Supabase Anon Key", "public"),
  environmentItem("SUPABASE_SERVICE_ROLE_KEY", "system", "Supabase Service Role Key", "secret"),

  environmentItem("KFSP_USERNAME", "provider", "KFSP Username", "secret"),
  environmentItem("KFSP_PASSWORD", "provider", "KFSP Password", "secret"),
  environmentItem("KFSP_SYNC_SECRET", "provider", "KFSP Sync Secret", "secret"),
  environmentItem("KFSP_MINIMUM_ROWS", "provider", "KFSP Minimum Rows Threshold", "internal"),

  environmentItem("SCANNER_RUN_SECRET", "scanner", "Scanner Run Secret", "secret"),
  environmentItem("SIGNAL_MONITOR_SECRET", "signals", "Signal Monitor Secret", "secret"),
  environmentItem("AI_COUNCIL_RUN_SECRET", "ai_council", "AI Council Run Secret", "secret"),
  environmentItem("MARKET_SYNC_SECRET", "market", "Market Sync Secret", "secret"),
  environmentItem("MARKET_CACHE_ADMIN_SECRET", "cache", "Market Cache Admin Secret", "secret"),
  environmentItem("CRON_SECRET", "system", "Vercel Cron Secret", "secret"),

  environmentItem("OPENAI_API_KEY", "ai_council", "OpenAI API Key", "secret"),
  environmentItem("AI_COUNCIL_LLM_ENABLED", "ai_council", "AI Council LLM Enabled (Env)", "internal"),
  environmentItem("AI_COUNCIL_LLM_BULL_MODEL", "ai_council", "AI Council Bull Agent Model", "internal"),
  environmentItem("AI_COUNCIL_LLM_BEAR_MODEL", "ai_council", "AI Council Bear Agent Model", "internal"),
  environmentItem("AI_COUNCIL_LLM_RISK_MODEL", "ai_council", "AI Council Risk Agent Model", "internal"),
  environmentItem("AI_COUNCIL_LLM_CHAIR_MODEL", "ai_council", "AI Council Chair Agent Model", "internal"),
  environmentItem("AI_COUNCIL_LLM_ESCALATION_MODEL", "ai_council", "AI Council Escalation Model", "internal"),
  environmentItem("AI_COUNCIL_LLM_FALLBACK_MODEL", "ai_council", "AI Council Fallback Model", "internal"),
  environmentItem("AI_COUNCIL_LLM_BULL_EFFORT", "ai_council", "AI Council Bull Effort", "internal"),
  environmentItem("AI_COUNCIL_LLM_BEAR_EFFORT", "ai_council", "AI Council Bear Effort", "internal"),
  environmentItem("AI_COUNCIL_LLM_RISK_EFFORT", "ai_council", "AI Council Risk Effort", "internal"),
  environmentItem("AI_COUNCIL_LLM_CHAIR_EFFORT", "ai_council", "AI Council Chair Effort", "internal"),
  environmentItem("AI_COUNCIL_LLM_ESCALATION_EFFORT", "ai_council", "AI Council Escalation Effort", "internal"),
  environmentItem("AI_COUNCIL_LLM_MAX_TICKERS", "ai_council", "AI Council Max Tickers (Env)", "internal"),
  environmentItem("AI_COUNCIL_LLM_TICKERS", "ai_council", "AI Council LLM Tickers (Env)", "internal"),
  environmentItem("AI_COUNCIL_RESEARCH_TICKERS", "ai_council", "AI Council Research Tickers (Env)", "internal"),

  environmentItem("SLACK_CONNECTOR", "integration", "Slack Connector Slug", "internal"),
  environmentItem("SLACK_ALERT_CHANNEL", "integration", "Slack Alert Channel Name", "internal"),
  environmentItem("SLACK_ALERT_CHANNEL_ID", "integration", "Slack Alert Channel ID", "internal"),

  environmentItem("ROOT_ADMIN_USER_IDS", "system", "Root Admin Allowlist", "secret"),
  environmentItem("APP_URL", "system", "Canonical Application URL", "public"),
  environmentItem("NEXT_PUBLIC_APP_URL", "system", "Next.js Public App URL", "public"),
  environmentItem("QSTASH_TOKEN", "system", "Upstash QStash Token", "secret"),

  environmentItem("NODE_ENV", "system", "Node Environment", "public"),
  environmentItem("VERCEL_ENV", "system", "Vercel Environment", "public"),
  environmentItem("VERCEL_URL", "system", "Vercel Deployment URL", "public"),
  environmentItem("VERCEL_PROJECT_PRODUCTION_URL", "system", "Vercel Production Domain", "public"),
  environmentItem("VERCEL_GIT_COMMIT_SHA", "system", "Vercel Git Commit SHA", "public"),
  environmentItem("VERCEL_GIT_PREVIOUS_SHA", "system", "Vercel Git Previous SHA", "public"),
  environmentItem("NEXT_PUBLIC_GIT_COMMIT_SHA", "system", "Public Git Commit SHA", "public"),
  environmentItem("NEXT_PUBLIC_GIT_COMMIT_DATE", "system", "Public Git Commit Date", "public"),
  environmentItem("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "system", "Public Vercel Commit SHA", "public"),
]

export function getAdminEnvironmentInventory(env: Record<string, string | undefined> = process.env): AdminEnvironmentItem[] {
  return ADMIN_ENVIRONMENT_INVENTORY.map((item) => {
    const rawValue = env[item.key]
    const isConfigured = rawValue !== undefined && rawValue !== ""
    return {
      ...item,
      isConfigured,
      value: item.sensitivity === "secret" ? undefined : (isConfigured ? rawValue : undefined),
    }
  })
}
