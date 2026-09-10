import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import "./market-insight-layout-regression.test.ts"
import "./sector-popup-canonical-parity.test.ts"

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
  for (const sectionId of ["sau-phien", "top-stocks", "nghien-cuu"]) {
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
  ]) {
    assert.match(dashboard, new RegExp(`<${component}\\b`), `${component} must be rendered in the dashboard`)
  }

  assert.doesNotMatch(dashboard, /MarketHistoryChart|MarketHistoryFlowChart/, "removed history panels must stay removed")
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
  const dataSource = fs.readFileSync(path.resolve("modules/research/market-insight/data.ts"), "utf8")

  assert.match(dataSource, /\.from\("market_insight_indexes"\)[\s\S]*\.eq\("index_code", "VNINDEX"\)[\s\S]*\.limit\(20\)/)
  assert.match(dataSource, /vnindexHistoryByDate/)
  assert.doesNotMatch(dataSource, /vnindexClose:\s*Math\.|vnindexClose:\s*\d/)
})

test("Market Close keeps the main dashboard continuous and limits tabs to the three market views", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const bubbles = fs.readFileSync(path.resolve("components/insights/market-bubbles.tsx"), "utf8")
  const sectors = fs.readFileSync(path.resolve("components/insights/sector-map-panel.tsx"), "utf8")

  assert.doesNotMatch(dashboard, /Tabs(Content|List|Trigger)?|activeTab|setActiveTab/, "the dashboard must not introduce a page-level tab system")
  assert.match(dashboard, /Nhịp đập thị trường/)
  assert.match(sectors, /Nỗ lực kết quả/)
  assert.match(dashboard, /Sức khoẻ thị trường/)
  assert.match(dashboard, /MarketSentimentCard/)
  assert.match(dashboard, /data-market-intelligence-overview-row[^>]*xl:grid-cols-3/)
  assert.match(dashboard, /data-market-health-embedded/)
  assert.doesNotMatch(fs.readFileSync(path.resolve("components/insights/market-health-view.tsx"), "utf8"), /<option value="(general|retail|institutional)">/)
  for (const period of ["1D", "1W", "1M", "1Y"]) {
    assert.match(bubbles, new RegExp(`value: "${period}"`), `market bubbles must expose the ${period} time window`)
  }
  assert.doesNotMatch(bubbles, /stock\.volume[^\n]*>\s*300_000/, "bubble field must not apply a second liquidity cutoff inside the canonical universe")
  assert.match(bubbles, /slice\(0, 200\)/, "bubble solver must keep the requested Top 200 cap")
  assert.match(dashboard, /min-h-\[650px\]/, "bubble layout must reserve stable space")
  assert.match(sectors, /SECTOR ROTATION MATRIX/, "sector workspace must expose the rotation view")
  for (const sectionId of ["market-overview-title", "market-sectors-title"]) {
    assert.match(dashboard, new RegExp(`id="${sectionId}"`), `${sectionId} must be visible in the continuous dashboard`)
  }
  assert.match(dashboard, /2xl:grid-cols-4/, "overview charts should use four columns on wide screens")
  assert.doesNotMatch(dashboard, /market-history-title|MarketHistoryChart|MarketHistoryFlowChart/)
  assert.match(dashboard, /data-stock-analytics-dashboard/, "the dashboard must preserve the analytics-first visual hierarchy")
  assert.match(bubbles, /node\.r \* 0\.12/, "bubble centers must reserve transformed hit-area margin")
  assert.match(bubbles, /node\.x = Math\.max\(node\.r \+ hitMargin/, "bubble x centers must stay inside the clickable field")
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

test("market-health children keep shared headers while AI conclusion uses its dedicated compact surface", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const health = fs.readFileSync(path.resolve("components/insights/market-health-view.tsx"), "utf8")
  const header = fs.readFileSync(path.resolve("components/insights/market-widget-child-header.tsx"), "utf8")

  assert.match(header, /actions\?: React\.ReactNode/)
  for (const title of [
    "Chỉ báo tâm lý",
    "Chỉ báo rủi ro",
    "Định giá thị trường (P/E & P/B)",
    "Hiệu suất chỉ số",
    "Độ rộng thị trường",
    "Sức khỏe xu hướng",
    "Dòng tiền tổ chức",
  ]) {
    assert.ok(`${dashboard}\n${health}`.includes(title), `missing child title: ${title}`)
  }
  assert.match(dashboard, /data-market-ai-conclusion/)
  assert.match(dashboard, /BrainCircuit/)
  assert.doesNotMatch(dashboard, /Tổng hợp định lượng|Tóm lược định lượng, không phải AI|Chưa có AI conclusion/)
  assert.doesNotMatch(`${dashboard}\n${health}`, /Tâm lý, rủi ro và MA20|Dòng tiền theo phiên/)
  assert.match(health, /<MarketWidgetChildHeader icon=\{ShieldAlert\}[^>]*actions=/)
  assert.match(health, /<MarketWidgetChildHeader icon=\{Gauge\}/)
  assert.doesNotMatch(health, /<h3[^>]*>\s*(Chỉ báo rủi ro|Định giá thị trường)/)
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

function qeo185History(vnindexStart: number, vnindexEnd: number, ma50Start: number, ma50End: number, count = 10) {
  return Array.from({ length: count }, (_, index) => {
    const ratio = count <= 1 ? 1 : index / (count - 1)
    return {
      sessionDate: `2026-09-${String(index + 1).padStart(2, "0")}`,
      vnindexClose: vnindexStart + (vnindexEnd - vnindexStart) * ratio,
      aboveMa20Pct: 50 + 4 * ratio,
      aboveMa50Pct: ma50Start + (ma50End - ma50Start) * ratio,
    }
  })
}

test("QEO-185 classifies multi-session breadth confirmation and divergences", async () => {
  const modulePath = path.resolve("modules/research/market-insight/breadth-divergence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-185 must add a pure breadth-divergence helper")
  const { buildBreadthDivergenceContext } = await import(modulePath)

  const confirmation = buildBreadthDivergenceContext({
    sessionDate: "2026-09-10",
    history: qeo185History(1000, 1010, 50, 55),
  })
  assert.equal(confirmation.state, "confirmation")
  assert.equal(confirmation.vnindexChangePct, 1)
  assert.equal(confirmation.ma50ChangePp, 5)

  const bearish = buildBreadthDivergenceContext({
    sessionDate: "2026-09-10",
    history: qeo185History(1000, 1010, 60, 55),
  })
  assert.equal(bearish.state, "bearish_divergence")

  const recovery = buildBreadthDivergenceContext({
    sessionDate: "2026-09-10",
    history: qeo185History(1000, 990, 40, 45),
  })
  assert.equal(recovery.state, "recovery_divergence")

  const neutral = buildBreadthDivergenceContext({
    sessionDate: "2026-09-10",
    history: qeo185History(1000, 1005, 50, 53),
  })
  assert.equal(neutral.state, "neutral")
})

test("QEO-185 stays unknown without at least eight paired sessions in the ten-session window", async () => {
  const modulePath = path.resolve("modules/research/market-insight/breadth-divergence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-185 must add a pure breadth-divergence helper")
  const { buildBreadthDivergenceContext } = await import(modulePath)

  const context = buildBreadthDivergenceContext({
    sessionDate: "2026-09-10",
    history: qeo185History(1000, 1010, 50, 55, 7),
  })
  assert.equal(context.state, "unknown")
  assert.equal(context.vnindexChangePct, null)
  assert.equal(context.ma50ChangePp, null)
})

test("QEO-185 upgrades the existing trend-health card with divergence context instead of adding a new dashboard section", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const breadthViewPath = path.resolve("components/insights/market-breadth-divergence-chart.tsx")

  assert.ok(fs.existsSync(breadthViewPath), "QEO-185 must add the focused breadth divergence view")
  const breadthView = fs.readFileSync(breadthViewPath, "utf8")

  assert.match(dashboard, /buildBreadthDivergenceContext\(\{[\s\S]*sessionDate: data\.sessionDate[\s\S]*history/)
  assert.match(dashboard, /title="Sức khỏe xu hướng"[\s\S]*actions=\{<BreadthDivergenceBadge state=\{breadthDivergence\.state\}/)
  assert.match(dashboard, /<MaBreadthChart daily=\{dailySummary\} context=\{breadthDivergence\}/)
  assert.equal((dashboard.match(/title="Sức khỏe xu hướng"/g) || []).length, 1, "breadth divergence must enrich the existing card only")

  assert.match(breadthView, /dataKey="vnindexClose"/)
  assert.match(breadthView, /dataKey="aboveMa50Pct"/)
  assert.match(breadthView, /aboveMa20Pct/)
  for (const label of ["MA10", "MA20", "MA50", "MA200"]) assert.match(breadthView, new RegExp(label))
})


test("QEO-186 sorts valid VNINDEX pullers and draggers while rejecting wrong-sign impacts", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor helper")
  const { buildVnindexContributorsContext } = await import(modulePath)

  const context = buildVnindexContributorsContext({
    vnindexChange: 3,
    leaders: [
      { category: "index_up", ticker: "AAA", estimatedIndexPoints: 1.2, rank: 3 },
      { category: "index_up", ticker: "BBB", estimatedIndexPoints: 2.5, rank: 1 },
      { category: "index_up", ticker: "BADUP", estimatedIndexPoints: -9, rank: 2 },
      { category: "index_down", ticker: "XXX", estimatedIndexPoints: -0.5, rank: 3 },
      { category: "index_down", ticker: "YYY", estimatedIndexPoints: -2, rank: 1 },
      { category: "index_down", ticker: "BADDOWN", estimatedIndexPoints: 4, rank: 2 },
      { category: "top_volume", ticker: "VOL", estimatedIndexPoints: 8, rank: 1 },
      { category: "index_up", ticker: "NULL", estimatedIndexPoints: null, rank: 4 },
    ],
  })

  assert.deepEqual(context.pullers.map((item: { ticker: string }) => item.ticker), ["BBB", "AAA"])
  assert.deepEqual(context.draggers.map((item: { ticker: string }) => item.ticker), ["YYY", "XXX"])
})

test("QEO-186 derives top-five and top-ten concentration from the side matching VNINDEX direction", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor helper")
  const { buildVnindexContributorsContext } = await import(modulePath)

  const leaders = [2, 1, 0.5, 0.3, 0.2, 0.1].map((impact, index) => ({
    category: "index_up",
    ticker: `UP${index + 1}`,
    estimatedIndexPoints: impact,
    rank: index + 1,
  }))
  leaders.push({ category: "index_down", ticker: "DOWN1", estimatedIndexPoints: -3, rank: 1 })

  const up = buildVnindexContributorsContext({ vnindexChange: 5, leaders })
  assert.equal(up.direction, "up")
  assert.equal(up.top5ContributionPct, 80)
  assert.equal(up.top10ContributionPct, 82)
  assert.equal(up.concentrationState, "high")

  const down = buildVnindexContributorsContext({
    vnindexChange: -4,
    leaders: [-1.5, -1, -0.5, -0.4, -0.3, -0.2].map((impact, index) => ({
      category: "index_down",
      ticker: `DN${index + 1}`,
      estimatedIndexPoints: impact,
      rank: index + 1,
    })),
  })
  assert.equal(down.direction, "down")
  assert.equal(down.top5ContributionPct, 92.5)
  assert.equal(down.top10ContributionPct, 97.5)
})

test("QEO-186 fails closed for invalid denominator and preserves valid concentration above 100 percent", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-186 must add a pure VNINDEX contributor helper")
  const { buildVnindexContributorsContext } = await import(modulePath)
  const leaders = [
    { category: "index_up", ticker: "AAA", estimatedIndexPoints: 1.5, rank: 1 },
    { category: "index_up", ticker: "BBB", estimatedIndexPoints: 1, rank: 2 },
    { category: "index_down", ticker: "CCC", estimatedIndexPoints: -0.5, rank: 1 },
  ]

  const offset = buildVnindexContributorsContext({ vnindexChange: 2, leaders })
  assert.equal(offset.top5ContributionPct, 125, "offsetting draggers can make gross leader contribution exceed the net move")
  assert.equal(offset.concentrationState, "high")

  for (const vnindexChange of [0, null, Number.NaN]) {
    const unknown = buildVnindexContributorsContext({ vnindexChange, leaders })
    assert.equal(unknown.top5ContributionPct, null)
    assert.equal(unknown.top10ContributionPct, null)
    assert.equal(unknown.concentrationState, "unknown")
  }
})

test("QEO-186 fails closed when same-direction contributor evidence is absent", async () => {
  const modulePath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  const { buildVnindexContributorsContext } = await import(modulePath)

  for (const input of [
    { vnindexChange: 2, leaders: [{ category: "index_down", ticker: "DOWN", estimatedIndexPoints: -1, rank: 1 }] },
    { vnindexChange: -2, leaders: [{ category: "index_up", ticker: "UP", estimatedIndexPoints: 1, rank: 1 }] },
    { vnindexChange: 2, leaders: [] },
  ]) {
    const context = buildVnindexContributorsContext(input)
    assert.equal(context.top5ContributionPct, null)
    assert.equal(context.top10ContributionPct, null)
    assert.equal(context.concentrationState, "unknown")
  }
})

test("QEO-186 renders contributors after market health and before deep-dive charts", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const helperPath = path.resolve("modules/research/market-insight/vnindex-contributors.ts")
  assert.ok(fs.existsSync(helperPath), "QEO-186 must add the contributor derivation helper")

  const health = dashboard.indexOf("data-market-health-embedded")
  const contributors = dashboard.indexOf("data-vnindex-contributors")
  const deepDive = dashboard.indexOf("data-market-close-chart-grid")
  assert.ok(contributors > health, "contributors must follow Market Health")
  assert.ok(contributors < deepDive, "contributors must precede deep-dive charts")
  assert.match(dashboard, /buildVnindexContributorsContext\(\{[\s\S]*vnindexChange:[\s\S]*leaders: data\.leaders/)
  assert.match(dashboard, /Đóng góp VNINDEX/)
  assert.match(dashboard, /Top 5/)
  assert.match(dashboard, /Top 10/)
  assert.match(dashboard, /<IndexImpactChart\b/)
})


function qeo187Session(index: number) {
  return `2026-08-${String(index + 1).padStart(2, "0")}`
}

test("QEO-187 computes exact Today 5D 20D flow persistence on one session calendar", async () => {
  const modulePath = path.resolve("modules/research/market-insight/institutional-flow-persistence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-187 must add a pure institutional-flow persistence helper")
  const { buildInstitutionalFlowPersistence } = await import(modulePath)
  const history = Array.from({ length: 20 }, (_, index) => ({
    sessionDate: qeo187Session(index),
    foreignNetValue: index < 15 ? -10 : 20,
    proprietaryNetValue: index < 15 ? 10 : -20,
    otherFlowNetValue: 2,
  }))

  const context = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history })
  const foreign = context.rows.find((row: { key: string }) => row.key === "foreign")
  const proprietary = context.rows.find((row: { key: string }) => row.key === "proprietary")
  const other = context.rows.find((row: { key: string }) => row.key === "other")

  assert.deepEqual(
    { today: foreign.today, fiveDay: foreign.fiveDay, twentyDay: foreign.twentyDay, state: foreign.state },
    { today: 20, fiveDay: 100, twentyDay: -50, state: "reversal_to_buying" },
  )
  assert.deepEqual(
    { today: proprietary.today, fiveDay: proprietary.fiveDay, twentyDay: proprietary.twentyDay, state: proprietary.state },
    { today: -20, fiveDay: -100, twentyDay: 50, state: "reversal_to_selling" },
  )
  assert.deepEqual(
    { today: other.today, fiveDay: other.fiveDay, twentyDay: other.twentyDay, state: other.state },
    { today: 2, fiveDay: 10, twentyDay: 40, state: "persistent_buying" },
  )
})

test("QEO-187 fails closed when a required flow observation or window session is missing", async () => {
  const modulePath = path.resolve("modules/research/market-insight/institutional-flow-persistence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-187 must add a pure institutional-flow persistence helper")
  const { buildInstitutionalFlowPersistence } = await import(modulePath)

  const missingObservation = Array.from({ length: 20 }, (_, index) => ({
    sessionDate: qeo187Session(index),
    foreignNetValue: index === 18 ? null : 10,
    proprietaryNetValue: 5,
    otherFlowNetValue: 1,
  }))
  const missingContext = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history: missingObservation })
  const foreign = missingContext.rows.find((row: { key: string }) => row.key === "foreign")
  assert.equal(foreign.fiveDay, null)
  assert.equal(foreign.twentyDay, null)
  assert.equal(foreign.state, "unknown")

  const nineteenSessions = Array.from({ length: 19 }, (_, index) => ({
    sessionDate: qeo187Session(index + 1),
    foreignNetValue: 10,
    proprietaryNetValue: -5,
    otherFlowNetValue: 1,
  }))
  const shortContext = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history: nineteenSessions })
  const shortForeign = shortContext.rows.find((row: { key: string }) => row.key === "foreign")
  assert.equal(shortForeign.today, 10)
  assert.equal(shortForeign.fiveDay, 50)
  assert.equal(shortForeign.twentyDay, null)
  assert.equal(shortForeign.state, "unknown")

  const noCurrent = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-21", history: nineteenSessions })
  const noCurrentForeign = noCurrent.rows.find((row: { key: string }) => row.key === "foreign")
  assert.deepEqual(
    { today: noCurrentForeign.today, fiveDay: noCurrentForeign.fiveDay, twentyDay: noCurrentForeign.twentyDay, state: noCurrentForeign.state },
    { today: null, fiveDay: null, twentyDay: null, state: "unknown" },
  )
})

test("QEO-187 keeps zero-sum windows unknown and separates facts from interpretation", async () => {
  const modulePath = path.resolve("modules/research/market-insight/institutional-flow-persistence.ts")
  assert.ok(fs.existsSync(modulePath), "QEO-187 must add a pure institutional-flow persistence helper")
  const { buildInstitutionalFlowPersistence } = await import(modulePath)
  const history = Array.from({ length: 20 }, (_, index) => ({
    sessionDate: qeo187Session(index),
    foreignNetValue: index < 15 ? -10 : [10, -10, 10, -10, 0][index - 15],
    proprietaryNetValue: 1,
    otherFlowNetValue: 1,
  }))
  const context = buildInstitutionalFlowPersistence({ sessionDate: "2026-08-20", history })
  const foreign = context.rows.find((row: { key: string }) => row.key === "foreign")
  assert.equal(foreign.fiveDay, 0)
  assert.equal(foreign.twentyDay, -150)
  assert.equal(foreign.state, "unknown")
})

test("QEO-187 upgrades the existing institutional-flow card to compact persistence view", () => {
  const dashboard = fs.readFileSync(path.resolve("components/insights/market-close-dashboard.tsx"), "utf8")
  const charts = fs.readFileSync(path.resolve("components/insights/market-close-charts.tsx"), "utf8")
  const dataSource = fs.readFileSync(path.resolve("modules/research/market-insight/data.ts"), "utf8")

  assert.match(dataSource, /foreign_net_value,proprietary_net_value,other_flow_net_value,total_traded_value/)
  assert.match(dataSource, /otherFlowNetValue: row\.other_flow_net_value/)
  assert.match(dashboard, /buildInstitutionalFlowPersistence\(\{[\s\S]*sessionDate: data\.sessionDate[\s\S]*history/)
  assert.match(dashboard, /<InstitutionalFlowChart context=\{flowPersistence\}/)

  const flowStart = charts.indexOf("export function InstitutionalFlowChart")
  const flowEnd = charts.indexOf("const sectorConfig", flowStart)
  const flow = charts.slice(flowStart, flowEnd)
  assert.match(flow, /data-institutional-flow-persistence/)
  for (const label of ["Khối ngoại", "Tự doanh", "Khác", "Today", "5D", "20D", "Xu hướng", "Chưa đủ dữ liệu"]) {
    assert.ok(flow.includes(label), `missing QEO-187 flow label: ${label}`)
  }
  assert.doesNotMatch(flow, /<BarChart|<AreaChart|<LineChart/, "QEO-187 should stay compact instead of adding another large chart")
})
