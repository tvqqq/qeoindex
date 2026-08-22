import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Insights homepage is a public route while research remains separately protected", () => {
  const page = source("app/insights/page.tsx")
  const gate = source("components/auth/app-auth-gate.tsx")
  const researchLayout = source("app/research/layout.tsx")

  assert.doesNotMatch(page, /getServerAuthContext|LandingLogin|requireApiFeature/)
  assert.match(gate, /pathname === "\/insights"/)
  assert.match(gate, /isPublicInsightsRoute\) return children/)
  assert.match(researchLayout, /getServerAuthContext/)
})

test("Insights read model composes public market, Supabase, and Notion projections", () => {
  const data = source("lib/insights-data.ts")
  const publicSupabase = source("lib/supabase/public-server.ts")

  assert.match(data, /fetchTradingViewIndexes/)
  assert.match(data, /from\("insights_stock_ratings"\)/)
  assert.match(data, /getResearchOverviewData/)
  assert.match(data, /getScannerData/)
  assert.match(data, /getSignalUiData/)
  assert.match(data, /FA_SCREEN_ROWS/)
  assert.match(publicSupabase, /NEXT_PUBLIC_SUPABASE_ANON_KEY/)
  assert.doesNotMatch(publicSupabase, /SUPABASE_SERVICE_ROLE_KEY/)
})

test("rating snapshots expose normalized public columns but keep ingestion metadata private", () => {
  const baseMigration = source("supabase/migrations/20260822084500_insights_stock_ratings.sql")
  const columnMigration = source("supabase/migrations/20260822090000_limit_insights_rating_public_columns.sql")

  for (const column of ["composite_score", "score_4m", "canslim_score", "stock_rs_score", "sector_rs_score", "stock_rrg_state", "sector_rrg_state"]) {
    assert.match(baseMigration, new RegExp(column))
  }
  assert.match(baseMigration, /enable row level security/)
  assert.match(baseMigration, /for select[\s\S]*to anon, authenticated[\s\S]*using \(true\)/)
  assert.doesNotMatch(baseMigration, /grant (insert|update|delete)/)

  assert.match(columnMigration, /revoke select on public\.insights_stock_ratings from anon/)
  assert.match(columnMigration, /revoke select on public\.insights_stock_ratings from authenticated/)
  assert.match(columnMigration, /grant select \([\s\S]*composite_score[\s\S]*fetched_at[\s\S]*\) on public\.insights_stock_ratings to anon/)
  assert.match(columnMigration, /\) on public\.insights_stock_ratings to authenticated/)
  assert.doesNotMatch(columnMigration, /source_url/)
  assert.doesNotMatch(columnMigration, /raw_payload/)
})

test("Insights UI uses Plus Jakarta ticker typography, shadcn primitives and reduced-motion SmoothUI patterns", () => {
  const dashboard = source("components/insights/insights-homepage.tsx")
  const shineCss = source("components/smoothui/shine-text.module.css")
  const glowCss = source("components/smoothui/glow-card.module.css")
  const nav = source("components/top-nav.tsx")

  assert.match(dashboard, /font-ticker/)
  assert.match(dashboard, /GlowCard/)
  assert.match(dashboard, /ShineText/)
  assert.match(dashboard, /TableHeader/)
  assert.match(dashboard, /Không tạo score giả/)
  assert.match(shineCss, /prefers-reduced-motion: reduce/)
  assert.match(glowCss, /prefers-reduced-motion: reduce/)
  assert.match(nav, /href: "\/insights"/)
  assert.match(nav, /PUBLIC/)
})
