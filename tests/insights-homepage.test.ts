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

test("rating snapshots are public-read and browser-write denied by schema", () => {
  const migration = source("supabase/migrations/20260822084500_insights_stock_ratings.sql")

  for (const column of ["composite_score", "score_4m", "canslim_score", "stock_rs_score", "sector_rs_score", "stock_rrg_state", "sector_rrg_state"]) {
    assert.match(migration, new RegExp(column))
  }
  assert.match(migration, /enable row level security/)
  assert.match(migration, /grant select on public\.insights_stock_ratings to anon/)
  assert.match(migration, /grant select on public\.insights_stock_ratings to authenticated/)
  assert.match(migration, /for select[\s\S]*to anon, authenticated[\s\S]*using \(true\)/)
  assert.doesNotMatch(migration, /grant (insert|update|delete)/)
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
