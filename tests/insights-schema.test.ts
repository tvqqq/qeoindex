import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const baseMigration = readFileSync("supabase/migrations/20260822083327_insights_stock_ratings.sql", "utf8")
const authMigration = readFileSync("supabase/migrations/20260822092848_require_auth_for_insights_stock_ratings.sql", "utf8")
const authGate = readFileSync("components/auth/app-auth-gate.tsx", "utf8")
const insightsData = readFileSync("lib/insights-data.ts", "utf8")
const insightsDashboard = readFileSync("components/insights/insights-dashboard.tsx", "utf8")
const pipelineMigration = readFileSync("supabase/migrations/20260822112420_kfsp_rating_pipeline.sql", "utf8")
const syncFunction = readFileSync("supabase/functions/kfsp-rating-sync/index.ts", "utf8")
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

test("insights has no public auth bypass and reads with the user-scoped client", () => {
  assert.doesNotMatch(authGate, /isPublicRoute/)
  assert.doesNotMatch(insightsData, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  assert.doesNotMatch(insightsData, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(insightsData, /getInsightsDashboardData\(supabase: SupabaseClient\)/)
  assert.match(insightsData, /\.from\("insights_stock_ratings"\)/)
  assert.match(insightsData, /\.eq\("is_published", true\)/)
  assert.match(insightsData, /baseQuery\(\)\.eq\("is_top100", true\)\.limit\(100\)/)
  assert.match(insightsData, /new Map\(/)
})

test("rating table exposes keyboard modal and hover tooltip interactions", () => {
  assert.match(insightsDashboard, /function RatingTooltip/)
  assert.match(insightsDashboard, /function RatingDialog/)
  assert.match(insightsDashboard, /aria-label={`Mở hồ sơ rating \$\{row\.ticker\}`}/)
  assert.match(insightsDashboard, /event\.key === "Enter" \|\| event\.key === " "/)
  assert.match(insightsDashboard, /Hồ sơ điểm hiện tại/)
  assert.match(insightsDashboard, /KFSP_GROUPS\.map/)
  assert.match(insightsDashboard, /Top 100/)
  assert.match(insightsDashboard, /MetricLabel/)
  assert.match(insightsDashboard, /role="tab"/)
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
  assert.match(syncFunction, /Deno\.env\.get\("KFSP_USERNAME"\)/)
  assert.match(syncFunction, /Deno\.env\.get\("KFSP_PASSWORD"\)/)
  assert.match(syncFunction, /AbortSignal\.timeout\(PROVIDER_TIMEOUT_MS\)/)
  assert.match(syncFunction, /constantTimeEqual\(expectedSecret, providedSecret\)/)
  assert.doesNotMatch(syncFunction, /@gmail\.com/i)
  assert.doesNotMatch(syncFunction, /Bearer\s+eyJ/i)
})

test("missing component scores fall back to the composite score instead of zero", () => {
  assert.match(insightsData, /if \(value == null \|\| value === ""\) return fallback/)
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
