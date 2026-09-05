import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const baseMigration = readFileSync("supabase/migrations/20260822083327_insights_stock_ratings.sql", "utf8")
const authMigration = readFileSync("supabase/migrations/20260822092848_require_auth_for_insights_stock_ratings.sql", "utf8")
const authGate = readFileSync("components/auth/app-auth-gate.tsx", "utf8")
const insightsData = readFileSync("modules/research/insights/data.ts", "utf8")
const insightsDashboard = readFileSync("components/insights/insights-dashboard.tsx", "utf8")
const ttaiDashboard = readFileSync("components/insights/ttai-dashboard.tsx", "utf8")
const chartPrimitive = readFileSync("components/ui/chart.tsx", "utf8")
const globalsCss = readFileSync("app/globals.css", "utf8")
const stockHistoryApi = readFileSync("app/api/insights/stock-history/route.ts", "utf8")
const pipelineMigration = readFileSync("supabase/migrations/20260822112420_kfsp_rating_pipeline.sql", "utf8")
const ttaiMigration = readFileSync("supabase/migrations/20260823104000_kfsp_ttai_history.sql", "utf8")
const ttaiScheduleMigration = readFileSync("supabase/migrations/20260826013742_reschedule_kfsp_ttai_daily_0100_ict.sql", "utf8")
const syncFunction = readFileSync("supabase/functions/kfsp-rating-sync/index.ts", "utf8")
const ttaiSyncFunction = readFileSync("supabase/functions/kfsp-ttai-history-sync/index.ts", "utf8")
const kfspProviderAuth = readFileSync("supabase/functions/_shared/kfsp-provider-auth.ts", "utf8")
const ttaiNormalize = readFileSync("supabase/functions/kfsp-ttai-history-sync/normalize.ts", "utf8")
const fieldCatalog = readFileSync("supabase/functions/_shared/kfsp-catalog.ts", "utf8")

test("stock ratings are authenticated read-only through RLS", () => {
  assert.match(baseMigration, /create table if not exists public\.insights_stock_ratings/i)
  assert.match(baseMigration, /alter table public\.insights_stock_ratings enable row level security/i)
  assert.match(authMigration, /revoke select[\s\S]*on public\.insights_stock_ratings from anon/i)
  assert.match(authMigration, /revoke all privileges on table public\.insights_stock_ratings from anon/i)
  assert.match(authMigration, /drop policy if exists insights_stock_ratings_public_read/i)
  assert.match(authMigration, /to authenticated\s+using \(is_published\)/i)
  assert.doesNotMatch(authMigration, /grant select[\s\S]*to anon/i)
  assert.doesNotMatch(authMigration, /grant (?:insert|update|delete)[^;]*to authenticated/i)
})

test("insights has no public auth bypass and reads only the canonical Top Stocks universe", () => {
  assert.doesNotMatch(authGate, /isPublicRoute/)
  assert.doesNotMatch(insightsData, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  assert.doesNotMatch(insightsData, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(insightsData, /getInsightsDashboardData\(supabase: SupabaseClient\)/)
  assert.match(insightsData, /getCanonicalUniverse/)
  assert.match(insightsData, /const tickers = universe\.stocks\.map\(\(stock\) => stock\.ticker\)/)
  assert.match(insightsData, /\.from\("insights_stock_ratings"\)/)
  assert.match(insightsData, /\.eq\("is_published", true\)/)
  assert.match(insightsData, /\.in\("ticker", tickers\)/)
  assert.match(insightsData, /\.in\("ticker", chunk\)/)
  assert.doesNotMatch(insightsData, /\.eq\("is_top100"/)
  assert.match(insightsData, /const bubbleStocks: InsightsBubbleStock\[\] = databaseRows/)
  assert.match(insightsData, /sort\(\(left, right\) => right\.averageVolume50Sessions - left\.averageVolume50Sessions/)
  assert.match(insightsData, /new Map\(/)
})

test("rating table exposes keyboard modal, grouped dashboard tabs, standalone Wyckoff action, history, and sector interactions", () => {
  assert.match(insightsDashboard, /function RatingTooltip/)
  assert.match(insightsDashboard, /function RatingDialog/)
  assert.match(insightsDashboard, /aria-label={`Mở hồ sơ rating \$\{row\.ticker\}`}/)
  assert.match(insightsDashboard, /event\.key === "Enter" \|\| event\.key === " "/)
  assert.match(insightsDashboard, /QeoIndex state radar/)
  assert.match(insightsDashboard, /RatingHistoryChart/)
  assert.match(insightsDashboard, /AccumulationHeatmap/)
  assert.match(insightsDashboard, /showSectorGroups/)
  assert.match(insightsDashboard, /Top Stocks/)
  assert.match(insightsDashboard, /MetricLabel/)
  assert.match(insightsDashboard, /role="tab"/)
  assert.match(insightsDashboard, /role="tablist"/)
  assert.match(ttaiDashboard, /role="tabpanel"/)
  assert.match(insightsDashboard, /type StockDetailTab = "overview" \| "info" \| "ta" \| "ttai"/)
  for (const tab of ["Tổng quan", "Thông tin doanh nghiệp", "Phân tích TA", "TTAI"]) {
    assert.match(insightsDashboard, new RegExp(`label: "${tab}"`))
  }
  for (const panel of ["overview", "info", "ta", "ttai"]) {
    assert.match(insightsDashboard + ttaiDashboard, new RegExp(`rating-panel-${panel}`))
  }
  assert.match(insightsDashboard, /aria-label="Công cụ phân tích chuyên sâu"/)
  assert.match(insightsDashboard, /href=\{`\/insights\/wyckoff\?ticker=\$\{row\.ticker\}&timeframe=1D`\}/)
  assert.match(insightsDashboard, /aria-label=\{`Phân tích chart Wyckoff \$\{row\.ticker\}`\}/)
  assert.match(insightsDashboard, /<span>Phân tích Wyckoff<\/span>/)
  assert.match(insightsDashboard, /prefetch=\{false\}/)
  assert.doesNotMatch(insightsDashboard, /Chart Wyckoff|WyckoffTabPanel|WyckoffStockWorkspace|rating-panel-wyckoff|rating-tab-wyckoff|topTab === "wyckoff"/)
  assert.doesNotMatch(insightsDashboard, /@\/components\/insights\/wyckoff-chart-dashboard|@\/modules\/wyckoff\/chart-model/)
  assert.doesNotMatch(insightsDashboard, /fetch\(`\/api\/insights\/wyckoff\?ticker=/)
  assert.doesNotMatch(insightsDashboard, /rating-panel-fa|rating-tab-fa|topTab === "fa"/)
  assert.doesNotMatch(insightsDashboard, /topTab === "metrics"/)
  assert.doesNotMatch(insightsDashboard, /topTab === "history"/)
  assert.doesNotMatch(insightsDashboard, /topTab === "kfsp"/)
  assert.doesNotMatch(insightsDashboard, /> Chỉ số cổ phiếu</)
  assert.match(insightsDashboard, /FA quick read[\s\S]*TA quick read[\s\S]*Range & thanh khoản/)
  assert.match(insightsDashboard, /<RatingRadar row=\{row\} \/>[\s\S]*<AccumulationHeatmap row=\{row\} \/>[\s\S]*Hiệu suất giá[\s\S]*<RatingHistoryChart row=\{row\} \/>/)
  assert.doesNotMatch(insightsDashboard, /<details className="rounded-2xl[\s\S]*Ma trận trạng thái & tích lũy/)
  assert.doesNotMatch(globalsCss, /#rating-panel-overview > :nth-child/)
  assert.match(insightsDashboard, /FA quick read/)
  assert.match(insightsDashboard, /TA quick read/)
  assert.match(insightsDashboard, /Thông tin doanh nghiệp/)
  assert.match(insightsDashboard, /Chỉ số tài chính & định giá/)
  assert.doesNotMatch(insightsDashboard, /Dữ liệu snapshot từ KFSP\/Supabase/)
  assert.match(insightsDashboard, /net_revenue_growth_pct/)
  assert.match(insightsDashboard, /price_vs_sma200_pct/)
  assert.match(insightsDashboard, /net_foreign_trading_billion/)
  assert.doesNotMatch(insightsDashboard, /useState<"top100" \| "all">/)
  assert.match(insightsDashboard, /sortKey="marketCapBillion"/)
  assert.match(insightsDashboard, /Vốn hóa/)
  assert.match(insightsDashboard, /SelectTrigger aria-label="Lọc theo ngành"/)
  assert.match(insightsDashboard, /function SortableHead/)
  assert.match(insightsDashboard, /sortKey="stockRrgState"/)
  assert.match(insightsDashboard, /RRG_FIELD_DEFINITIONS\.sectorRrgState/)
  assert.match(insightsDashboard, /getSectorIcon/)
  assert.match(insightsDashboard, /expandedSectors/)
  assert.match(insightsDashboard, /aria-expanded=\{isExpanded\}/)
  assert.match(insightsDashboard, /aria-controls=\{`sector-children-\$\{index\}`\}/)
  assert.match(insightsData, /kfsp_stock_rrg_state,kfsp_sector_rrg_state/)
  assert.match(insightsData, /loadHistoryDates/)
  assert.match(insightsData, /buildSectorSummaries/)
})

test("TTAI charts use shadcn Recharts composition and keep the KPI strip first", () => {
  assert.match(chartPrimitive, /function ChartContainer/)
  assert.match(chartPrimitive, /const ChartTooltip = RechartsPrimitive\.Tooltip/)
  assert.match(chartPrimitive, /function ChartTooltipContent/)
  assert.match(ttaiDashboard, /ChartContainer/)
  assert.match(ttaiDashboard, /ChartTooltipContent/)
  assert.match(ttaiDashboard, /AreaChart/)
  assert.match(ttaiDashboard, /RadarChart/)
  assert.match(ttaiDashboard, /indicator="line"/)
  for (const label of ["4M hiện tại", "CANSLIM hiện tại", "RS-S cổ phiếu", "RS-S ngành"]) {
    assert.match(ttaiDashboard, new RegExp(label))
  }
  const kpiIndex = ttaiDashboard.indexOf("4M hiện tại")
  const loadingIndex = ttaiDashboard.indexOf("{loading &&")
  assert.ok(kpiIndex >= 0 && loadingIndex > kpiIndex, "TTAI KPI strip should render before loading/history content")
  assert.doesNotMatch(ttaiDashboard, /Lịch sử RS-S, RRG, 4M và CANSLIM\. Dữ liệu provider được chuẩn hóa vào Supabase/)
})

test("TTAI history UI compares RS-S, exposes RRG history, and renders 4M/CANSLIM quarterly charts", () => {
  assert.match(ttaiDashboard, /RS-S cổ phiếu vs RS-S ngành/)
  assert.match(ttaiDashboard, /RRG cổ phiếu/)
  assert.match(ttaiDashboard, /RRG ngành/)
  assert.match(ttaiDashboard, /ScoreSection title="Điểm 4M"/)
  assert.match(ttaiDashboard, /ScoreSection title="Điểm CANSLIM"/)
  assert.match(ttaiDashboard, /ComponentRadar/)
  assert.match(ttaiDashboard, /COMPONENT_HELP/)
  assert.match(ttaiDashboard, /KFSP snapshot hiện không cung cấp tọa độ RRG gốc/)
  assert.match(ttaiDashboard, /fetch\(`\/api\/insights\/stock-history\?ticker=/)
})

test("TTAI quarterly history is normalized, authenticated read-only, and canonical-universe scoped", () => {
  assert.match(ttaiMigration, /create table if not exists public\.kfsp_ttai_quarterly_history/i)
  assert.match(ttaiMigration, /primary key \(ticker, period\)/i)
  assert.match(ttaiMigration, /fourm_components jsonb/i)
  assert.match(ttaiMigration, /canslim_components jsonb/i)
  assert.match(ttaiMigration, /enable row level security/i)
  assert.match(ttaiMigration, /grant select \([\s\S]*\) on public\.kfsp_ttai_quarterly_history to authenticated/i)
  assert.doesNotMatch(ttaiMigration, /grant select[\s\S]*kfsp_ttai_quarterly_history[\s\S]*to anon/i)
  assert.match(ttaiScheduleMigration, /cron\.unschedule\('kfsp-ttai-history-hourly'\)/i)
  assert.match(ttaiScheduleMigration, /'kfsp-ttai-history-daily-1am-ict',[\s\S]*'0 18 \* \* \*'/i)
  assert.match(ttaiMigration, /vault\.decrypted_secrets where name = 'kfsp_sync_secret'/i)
  assert.match(ttaiSyncFunction, /fourm-canslim-point-chart/)
  assert.match(ttaiSyncFunction, /currentFinancialPeriod/)
  assert.match(ttaiSyncFunction, /state\.get\(row\.ticker\) !== row\.financialPeriod/)
  assert.match(ttaiSyncFunction, /from "\.\/normalize\.ts"/)
  assert.match(ttaiSyncFunction, /qeo_current_market_universe/)
  assert.match(ttaiSyncFunction, /vn_top_stocks/)
  assert.match(ttaiSyncFunction, /getKfspProviderToken/)
  assert.doesNotMatch(ttaiSyncFunction, /is_top100|top100_rank|kfsp_provider_tokens/)
  assert.match(ttaiNormalize, /periods\.length - values\.length/)
  assert.match(ttaiNormalize, /fourm_option_history_chart/)
  assert.match(ttaiNormalize, /canslim_option_history_chart/)
  assert.match(ttaiNormalize, /data_table_4m/)
  assert.match(ttaiNormalize, /data_table_canslim/)
  assert.match(kfspProviderAuth, /Deno\.env\.get\("KFSP_USERNAME"\)/)
  assert.match(kfspProviderAuth, /Deno\.env\.get\("KFSP_PASSWORD"\)/)
  assert.match(kfspProviderAuth, /qeo_get_kfsp_credentials/)
  assert.match(kfspProviderAuth, /qeo_get_kfsp_provider_token_cache/)
  assert.match(kfspProviderAuth, /qeo_set_kfsp_provider_token_cache/)
  assert.doesNotMatch(kfspProviderAuth, /kfsp_provider_tokens/)
  assert.doesNotMatch(ttaiSyncFunction + kfspProviderAuth, /Bearer\s+eyJ/i)
})

test("stock history endpoint is server-authenticated and never trusts a client user id", () => {
  assert.match(stockHistoryApi, /requireApiUser\(\)/)
  assert.match(stockHistoryApi, /TICKER_PATTERN/)
  assert.match(stockHistoryApi, /\.from\("insights_stock_ratings"\)/)
  assert.match(stockHistoryApi, /\.from\("kfsp_ttai_quarterly_history"\)/)
  assert.doesNotMatch(stockHistoryApi, /user_id/)
  assert.doesNotMatch(stockHistoryApi, /SUPABASE_SERVICE_ROLE_KEY/)
})

test("KFSP contract maps all nine provider groups without leaking provider credentials", () => {
  for (const group of ["overview", "general", "valuation", "fundamentals", "price_volatility", "price_range", "liquidity", "technical", "kfsp"]) {
    assert.match(fieldCatalog, new RegExp(`key: "${group}"`))
  }
  for (const providerKey of ["gia_hien_tai", "diem_4m", "diem_canslim", "rs_s_co_phieu", "rs_m_co_phieu", "rs_l_co_phieu", "rs_nganh", "rrg_co_phieu", "rsi_14", "macd_vs_signal", "klgd_tb_50_ngay"]) {
    assert.match(fieldCatalog, new RegExp(`"${providerKey}"`))
  }
  assert.match(syncFunction, /providerPrice == null \? null : providerPrice \/ 1_000/)
  assert.match(syncFunction, /metrics\.overview\.rs_short = metrics\.kfsp\.kfsp_stock_rs_score/)
  assert.match(syncFunction, /getKfspProviderToken/)
  assert.match(kfspProviderAuth, /Deno\.env\.get\("KFSP_USERNAME"\)/)
  assert.match(kfspProviderAuth, /Deno\.env\.get\("KFSP_PASSWORD"\)/)
  assert.match(kfspProviderAuth, /AbortSignal\.timeout\(options\.timeoutMs\)/)
  assert.match(kfspProviderAuth, /qeo_get_kfsp_credentials/)
  assert.match(syncFunction, /constantTimeEqual\(expectedSecret, providedSecret\)/)
  assert.match(syncFunction, /api\/watchlist\/canslim-fourm\/by-mack/)
  assert.match(syncFunction, /url\.searchParams\.append\("mack\[\]", ticker\)/)
  assert.match(syncFunction, /Object\.assign\(providerRecord, supplemental\.get\(ticker\) \|\| \{\}\)/)
  assert.match(syncFunction, /function pricePotentialLabel\(value: JsonValue \| undefined\)/)
  assert.doesNotMatch(syncFunction, /fairValue \/ price/)
  assert.doesNotMatch(syncFunction + kfspProviderAuth, /@gmail\.com/i)
  assert.doesNotMatch(syncFunction + kfspProviderAuth, /Bearer\s+eyJ/i)
})

test("missing KFSP component scores stay null instead of inheriting a composite score", () => {
  assert.match(insightsData, /technical: number \| null/)
  assert.match(insightsData, /momentum: number \| null/)
  assert.doesNotMatch(insightsData, /return fallback/)
})

test("KFSP snapshot publish is atomic, authenticated read-only, and scheduled for 07:00 ICT", () => {
  assert.match(pipelineMigration, /create table if not exists public\.kfsp_rating_staging/i)
  assert.match(pipelineMigration, /create or replace function public\.publish_kfsp_rating_snapshot/i)
  assert.match(pipelineMigration, /delete from public\.insights_stock_ratings[\s\S]*insert into public\.insights_stock_ratings/i)
  assert.match(pipelineMigration, /grant select \([\s\S]*\) on public\.insights_stock_ratings to authenticated/i)
  assert.doesNotMatch(pipelineMigration, /grant select[\s\S]*to anon/i)
  assert.match(pipelineMigration, /'kfsp-rating-daily-7am-ict',[\s\S]*'0 0 \* \* \*'/i)
  assert.match(pipelineMigration, /vault\.decrypted_secrets where name = 'kfsp_sync_secret'/i)
  assert.match(pipelineMigration, /timeout_milliseconds := 55000/i)
})

test("stock detail workstation integrates insights rating tabs and removes methodology footer", () => {
  const workstation = readFileSync("components/stock-detail/stock-detail-workstation.tsx", "utf8")
  const tabsPanel = readFileSync("components/stock-detail/stock-tabs-panel.tsx", "utf8")
  const stockDetailData = readFileSync("modules/research/insights/stock-detail-data.ts", "utf8")

  // 1. Methodology footer is removed
  assert.doesNotMatch(workstation, /Methodology: Workstation chi tiết cổ phiếu kết hợp dữ liệu kỹ thuật/)

  // 2. 4 Tabs integrated matching Insights modal
  assert.match(tabsPanel, /type StockDetailTab = "overview" \| "info" \| "ta" \| "ttai"/)
  for (const tab of ["Tổng quan", "Thông tin doanh nghiệp", "Phân tích TA", "TTAI"]) {
    assert.match(tabsPanel, new RegExp(`label: "${tab}"`))
  }
  for (const panel of ["overview", "info", "ta", "ttai"]) {
    assert.match(tabsPanel, new RegExp(`rating-panel-${panel}|TtaiDashboard`))
  }

  // 3. Wyckoff link action
  assert.match(tabsPanel, /href=\{`\/insights\/wyckoff\?ticker=\$\{row\.ticker\}&timeframe=1D`\}/)
  assert.match(tabsPanel, /<span>Phân tích Wyckoff<\/span>/)

  // 4. Rating components present
  assert.match(tabsPanel, /RatingRadar/)
  assert.match(tabsPanel, /AccumulationHeatmap/)
  assert.match(tabsPanel, /RatingHistoryChart/)
  assert.match(tabsPanel, /TtaiDashboard/)

  // 5. Stock detail data fetches rating row and has fallback
  assert.match(stockDetailData, /getInsightsRatingForTicker\(supabase, decoded\)/)
  assert.match(stockDetailData, /buildFallbackRatingRow/)
})

test("stock detail workstation pins sidebars and allows center column scrolling on desktop", () => {
  const workstation = readFileSync("components/stock-detail/stock-detail-workstation.tsx", "utf8")
  const watchlist = readFileSync("components/stock-detail/stock-watchlist-sidebar.tsx", "utf8")

  // Root clamped to viewport on desktop
  assert.match(workstation, /lg:h-screen lg:overflow-hidden/)
  assert.match(workstation, /lg:overflow-hidden min-h-0/)

  // Left sidebar is pinned (scrollable internally if needed)
  assert.match(workstation, /lg:h-full lg:overflow-y-auto no-scrollbar/)

  // Center column is the only scrollable workstation pane on desktop
  assert.match(workstation, /ref=\{centerColumnRef\}/)
  assert.match(workstation, /lg:h-full lg:overflow-y-auto pr-1 pb-10/)
  assert.match(workstation, /centerColumnRef\.current\?\.scrollTo\(\{ top: 0, behavior: "smooth" \}\)/)

  // Right sidebar is pinned with internal list scroll
  assert.match(workstation, /<aside className="w-full lg:h-full lg:overflow-hidden">/)
  assert.match(watchlist, /min-h-\[500px\] lg:min-h-0 flex-col overflow-hidden/)
  assert.match(watchlist, /overflow-y-auto/)
})

