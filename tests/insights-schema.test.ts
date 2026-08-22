import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const baseMigration = readFileSync("supabase/migrations/20260822083327_insights_stock_ratings.sql", "utf8")
const authMigration = readFileSync("supabase/migrations/20260822092848_require_auth_for_insights_stock_ratings.sql", "utf8")
const authGate = readFileSync("components/auth/app-auth-gate.tsx", "utf8")
const insightsData = readFileSync("lib/insights-data.ts", "utf8")
const insightsDashboard = readFileSync("components/insights/insights-dashboard.tsx", "utf8")

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
})

test("rating table exposes keyboard modal and hover tooltip interactions", () => {
  assert.match(insightsDashboard, /function RatingTooltip/)
  assert.match(insightsDashboard, /function RatingDialog/)
  assert.match(insightsDashboard, /aria-label={`Mở hồ sơ rating \$\{row\.ticker\}`}/)
  assert.match(insightsDashboard, /event\.key === "Enter" \|\| event\.key === " "/)
  assert.match(insightsDashboard, /Hồ sơ điểm hiện tại/)
})
