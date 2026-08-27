import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"

test("UI performance invariants: market-close dashboard adheres strictly to UI_LESSONS_LEARNED", () => {
  const componentPath = path.resolve("components/insights/market-close-dashboard.tsx")
  assert.ok(fs.existsSync(componentPath), "market-close-dashboard.tsx must exist")

  const content = fs.readFileSync(componentPath, "utf8")

  // Rule 1: No backdrop-blur-* / backdrop-filter near charts/tables/dense UI
  assert.doesNotMatch(
    content,
    /backdrop-blur|backdrop-filter/i,
    "market-close-dashboard.tsx must not use backdrop-blur or backdrop-filter"
  )

  // Rule 2: No transition-all
  assert.doesNotMatch(
    content,
    /transition-all/i,
    "market-close-dashboard.tsx must not use transition-all"
  )

  // Rule 3: Dynamic ticker links must use prefetch={false} if using Next.js Link
  const linkMatches = content.match(/<Link[^>]*>/g) || []
  for (const linkTag of linkMatches) {
    if (linkTag.includes("ticker") || linkTag.includes("/insights/wyckoff")) {
      assert.ok(
        linkTag.includes('prefetch={false}'),
        `Dynamic ticker Link must have prefetch={false}: ${linkTag}`
      )
    }
  }
})

test("Insights shell stays visible across server render and hydration", () => {
  const componentPath = path.resolve("components/insights/insights-dashboard.tsx")
  const content = fs.readFileSync(componentPath, "utf8")

  assert.doesNotMatch(
    content,
    /<InsightsTransition\b|data-insights-transition/,
    "the page shell must not fade from SSR content to opacity 0 during hydration"
  )
  assert.doesNotMatch(
    content,
    /<SoftBlurIn\b|animate-pulse|animate-\[spin_/,
    "the Insights hero must not use blur or continuous entrance animations"
  )
  assert.doesNotMatch(
    content,
    /min-h-screen[^"\n]*font-ticker/,
    "decorative ticker typography must stay scoped instead of affecting the page root"
  )
})

test("Insights is one continuous dashboard without primary tabs or a sticky section navigator", () => {
  const content = fs.readFileSync(path.resolve("components/insights/insights-dashboard.tsx"), "utf8")

  assert.doesNotMatch(content, /mainTab|setMainTab/, "primary dashboard sections must not be conditionally remounted")
  for (const sectionId of ["sau-phien", "top-100", "nghien-cuu"]) {
    assert.match(content, new RegExp(`id="${sectionId}"`), `${sectionId} must exist on the unified dashboard`)
  }
  assert.doesNotMatch(content, /Điều hướng dashboard Insights|href="#sau-phien"/, "the removed section navigator must stay removed")
  assert.match(content, /<details[^>]*className="group[^"]*"/)
  assert.match(content, /Top cổ phiếu rating score/)
  assert.doesNotMatch(content, /Tổng quan VNIndex|Market pulse/, "duplicate Top 100 market summary must stay removed")
  assert.match(content, /data\.marketClose\?\.isStale/)
  assert.match(content, /Dữ liệu thị trường cũ \(Stale\)/)
})

test("authenticated shell survives transient token refresh sync failures", () => {
  const content = fs.readFileSync(path.resolve("components/auth/app-auth-gate.tsx"), "utf8")

  assert.match(content, /serverSessionPresent \? "authenticated"/, "server-verified content must remain visible during hydration")
  assert.match(content, /authenticatedRef\.current \|\| serverSessionPresent/, "transient sync failures must preserve a verified session")
  assert.match(content, /generation !== syncGenerationRef\.current/, "stale overlapping session syncs must be ignored")
})

test("Market Close dashboard uses stable accessible shadcn chart composition", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const charts = fs.readFileSync(path.resolve("components/insights/market-close-charts.tsx"), "utf8")

  for (const component of [
    "IndexPerformanceChart",
    "IndexBreadthChart",
    "MaBreadthChart",
    "InstitutionalFlowChart",
    "SectorPerformanceChart",
    "SectorBreadthChart",
    "LiquidityLeadersChart",
    "MarketHistoryChart",
    "MarketHistoryFlowChart",
  ]) {
    assert.match(dashboard, new RegExp(`<${component}\\b`), `${component} must be rendered in the dashboard`)
  }

  assert.match(charts, /ChartContainer/)
  assert.match(charts, /ChartTooltipContent/)
  assert.ok((charts.match(/accessibilityLayer/g) || []).length >= 8, "charts must expose Recharts accessibility layers")
  assert.ok((charts.match(/initialDimension=/g) || []).length >= 8, "charts must have stable initial dimensions")
  assert.doesNotMatch(charts, /backdrop-blur|backdrop-filter|transition-all|filter:/i)
})

test("Market Close presents every insight section on one tab-free dashboard", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")

  assert.doesNotMatch(dashboard, /Tabs(Content|List|Trigger)?|activeTab|setActiveTab/, "market-close indicators must not be hidden behind tabs")
  for (const sectionId of ["market-overview-title", "market-sectors-title", "market-leaders-title", "market-history-title"]) {
    assert.match(dashboard, new RegExp(`id="${sectionId}"`), `${sectionId} must be visible in the continuous dashboard`)
  }
  assert.match(dashboard, /2xl:grid-cols-4/, "overview charts should use four columns on wide screens")
  assert.match(dashboard, /2xl:grid-cols-3/, "leader cards should use three columns on wide screens")
  assert.doesNotMatch(dashboard, /Dữ liệu thị trường cũ \(Stale\)/, "stale status belongs in the page header, not inside the market dashboard")
})

test("Market Close charts use a minimal semantic palette without SVG gradients", () => {
  const charts = fs.readFileSync(path.resolve("components/insights/market-close-charts.tsx"), "utf8")

  assert.match(charts, /const POSITIVE/)
  assert.match(charts, /const NEGATIVE/)
  assert.match(charts, /const NEUTRAL/)
  assert.match(charts, /const ACCENT/)
  assert.doesNotMatch(charts, /linearGradient|url\(#/, "chart fills must remain flat and minimal")
})
