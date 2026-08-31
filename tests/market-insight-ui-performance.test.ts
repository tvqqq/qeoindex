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
  assert.match(content, /Top cổ phiếu theo Qeo composite/)
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
    "MarketHistoryChart",
    "MarketHistoryFlowChart",
  ]) {
    assert.match(dashboard, new RegExp(`<${component}\\b`), `${component} must be rendered in the dashboard`)
  }

  assert.match(charts, /ChartContainer/)
  assert.match(charts, /ChartTooltipContent/)
  assert.ok((charts.match(/accessibilityLayer/g) || []).length >= 10, "charts must expose Recharts accessibility layers")
  assert.ok((charts.match(/initialDimension=/g) || []).length >= 10, "charts must have stable initial dimensions")
  assert.doesNotMatch(charts, /backdrop-blur|backdrop-filter|transition-all|filter:/i)
})

test("Liquid Glass Insights styling stays compositor-safe around charts", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const globalCss = fs.readFileSync(path.resolve("app/globals.css"), "utf8")
  const scopedStart = globalCss.indexOf(".insights-liquid-shell")
  const scopedEnd = globalCss.indexOf(".liquid-glass-surface", scopedStart)
  const scopedCss = globalCss.slice(scopedStart, scopedEnd)

  assert.match(dashboard, /data-liquid-glass-dashboard/)
  assert.match(scopedCss, /insights-glass-panel/)
  assert.doesNotMatch(scopedCss, /backdrop-filter|\bfilter\s*:|transition:\s*all/i)
})

test("VNINDEX hero history comes from a bounded canonical-index query", () => {
  const dataSource = fs.readFileSync(path.resolve("lib/market-insight-data.ts"), "utf8")

  assert.match(dataSource, /\.from\("market_insight_indexes"\)[\s\S]*\.eq\("index_code", "VNINDEX"\)[\s\S]*\.limit\(20\)/)
  assert.match(dataSource, /vnindexHistoryByDate/)
  assert.doesNotMatch(dataSource, /vnindexClose:\s*Math\.|vnindexClose:\s*\d/)
})

test("Market Close keeps the main dashboard continuous and limits tabs to the three market views", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const bubbles = fs.readFileSync(path.resolve("components/insights/market-bubbles.tsx"), "utf8")

  assert.doesNotMatch(dashboard, /Tabs(Content|List|Trigger)?|activeTab|setActiveTab/, "the dashboard must not introduce a page-level tab system")
  assert.match(dashboard, /Nhịp đập thị trường/)
  assert.match(dashboard, /Nỗ lực kết quả/)
  assert.match(dashboard, /Sức khoẻ thị trường/)
  assert.match(dashboard, /MarketSentimentCard/)
  assert.match(dashboard, /xl:grid-cols-\[7fr_3fr\]/)
  assert.doesNotMatch(fs.readFileSync(path.resolve("components/insights/market-health-view.tsx"), "utf8"), /<option value="(general|retail|institutional)">/)
  for (const period of ["1D", "1W", "1M", "1Y"]) {
    assert.match(bubbles, new RegExp(`value: "${period}"`), `market bubbles must expose the ${period} time window`)
  }
  assert.match(bubbles, /filter\(\(stock\) => \(stock\.volume \?\? 0\) > 500_000\)/, "bubble field must exclude stocks at or below the provider threshold")
  assert.match(bubbles, /slice\(0, 200\)/, "bubble solver must keep the requested Top 200 cap")
  assert.match(dashboard, /min-h-\[650px\]/, "bubble layout must reserve stable space")
  assert.match(dashboard, /Luân chuyển dòng tiền/, "sector workspace must expose the rotation view")
  for (const sectionId of ["market-overview-title", "market-sectors-title", "market-history-title"]) {
    assert.match(dashboard, new RegExp(`id="${sectionId}"`), `${sectionId} must be visible in the continuous dashboard`)
  }
  assert.match(dashboard, /2xl:grid-cols-4/, "overview charts should use four columns on wide screens")
  assert.match(dashboard, /MarketHistoryChart history=\{history\}/)
  assert.match(dashboard, /MarketHistoryFlowChart history=\{history\}/)
  assert.match(dashboard, /data-stock-analytics-dashboard/, "the dashboard must preserve the analytics-first visual hierarchy")
  assert.doesNotMatch(dashboard, /<Table\b/, "market-close analytics should prioritize charts over long data tables")
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

test("sector matrix keeps provider liquidity and sector labels honest", () => {
  const sectors = fs.readFileSync(path.resolve("components/insights/sector-map-panel.tsx"), "utf8")
  assert.match(sectors, /function SectorLabel/)
  assert.match(sectors, /Đơn vị nguồn chưa xác minh/)
  assert.doesNotMatch(sectors, /📊/)
  assert.match(sectors, /aria-label=\{`Nỗ lực/)
  assert.match(sectors, /function RotationBadge/)
  assert.doesNotMatch(sectors, /<span>~<\/span>/)
})

test("admin AI cost tooltips never expose more than two display decimals", () => {
  const adminJobs = fs.readFileSync(path.resolve("components/admin/admin-jobs-table.tsx"), "utf8")
  assert.match(adminJobs, /function formatEstimatedCost/)
  assert.match(adminJobs, /value < 0\.01/)
  assert.doesNotMatch(adminJobs, /estimatedCostUsd\.toFixed\(6\)/)
})

test("market health SVG coordinates are stable across server and browser hydration", () => {
  const health = fs.readFileSync(path.resolve("components/insights/market-health-view.tsx"), "utf8")

  assert.match(health, /function stableSvgCoordinate\(value: number\)/)
  assert.match(health, /Number\(value\.toFixed\(6\)\)/)
  assert.ok((health.match(/stableSvgCoordinate\(/g) || []).length >= 17, "all computed gauge coordinates must be rounded")
})
