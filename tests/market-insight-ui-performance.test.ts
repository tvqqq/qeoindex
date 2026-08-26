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

test("Insights is one dashboard with stable section navigation instead of remounting primary tabs", () => {
  const content = fs.readFileSync(path.resolve("components/insights/insights-dashboard.tsx"), "utf8")

  assert.doesNotMatch(content, /mainTab|setMainTab/, "primary dashboard sections must not be conditionally remounted")
  for (const sectionId of ["sau-phien", "top-100", "nghien-cuu"]) {
    assert.match(content, new RegExp(`id="${sectionId}"`), `${sectionId} must exist on the unified dashboard`)
    assert.match(content, new RegExp(`href="#${sectionId}"`), `${sectionId} must be reachable from the dashboard navigator`)
  }
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
