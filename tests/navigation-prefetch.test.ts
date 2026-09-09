import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("dense ticker lists do not auto-prefetch every dynamic research route", () => {
  const helper = source("components/ticker-research-link.tsx")
  assert.match(helper, /prefetch=\{false\}/)
  assert.match(helper, /router\.prefetch\(href\)/)

  const forbiddenDynamicResearchHref = "href={`/research/${"

  for (const path of [
    "components/live-market-stock.tsx",
    "components/research/scanner-app.tsx",
    "components/research/fa-screen-app.tsx",
    "components/research/research-app.tsx",
    "components/research/signals-app.tsx",
  ]) {
    const file = source(path)
    assert.match(file, /TickerResearchLink/, `${path} should use intent-prefetch ticker links`)
    assert.equal(file.includes(forbiddenDynamicResearchHref), false, `${path} must not auto-prefetch dynamic ticker routes`)
  }
})

test("Wyckoff shell defers heavy chart work and avoids compositor-heavy navigation effects", () => {
  const deferred = source("components/insights/wyckoff-deferred-dashboard.tsx")
  const infographic = source("components/insights/wyckoff-infographic-dashboard.tsx")
  const files = `${deferred}\n${infographic}`

  assert.equal(files.includes("backdrop-blur-2xl"), false, "Wyckoff workspace must not use backdrop-filter blur")
  assert.equal(files.includes("transition-all"), false, "Wyckoff interactions should transition only bounded properties")
  assert.equal(files.includes("data-wyckoff-back-row"), false, "Wyckoff should not reserve a separate Rating navigation row")
  assert.equal(files.includes("Quay lại Rating"), false, "Wyckoff should not restore the removed Rating control")
  assert.match(deferred, /dynamic\(/)
  assert.match(deferred, /ssr:\s*false/)
  assert.match(deferred, /requestAnimationFrame/)
  assert.match(deferred, /AbortController/)
  assert.doesNotMatch(deferred, /<Link/)
})

test("top navigation restores Insights as a styled parent menu with three child pages", () => {
  const nav = source("components/top-nav.tsx")

  assert.match(nav, /const INSIGHTS_ITEMS = \[/)
  assert.match(nav, /label: "Tổng quan Insights",\s*href: "\/insights"/)
  assert.match(nav, /label: "Phân tích chart Wyckoff",\s*href: "\/insights\/wyckoff"/)
  assert.match(nav, /label: "Nghiên cứu",\s*href: "\/research"/)
  assert.match(nav, /<ChevronDown/)
  assert.match(nav, /href="\/insights"[\s\S]*onClick=\{\(\) => setIsOpen\(false\)\}/, "clicking the Insights parent label should still open /insights")
  assert.match(nav, /aria-label="Các trang Insights"/)
  assert.match(nav, /<nav className="[^\"]*min-w-0[^\"]*items-center[^\"]*rounded-full/, "top navigation must remain a bounded flex row")
  assert.doesNotMatch(nav, /<nav className="[^\"]*overflow-x-auto/, "top navigation must not clip its dropdown on mobile")
  assert.match(nav, /className=\{isBoardActive \? "" : "hidden sm:inline"\}/, "inactive board label must compact on mobile")
  assert.match(nav, /className=\{isPortfolioActive \? "" : "hidden sm:inline"\}/, "inactive portfolio label must compact on mobile")
  assert.match(nav, /fixed left-4 right-4 top-14 z-50 pt-2 sm:absolute sm:left-0 sm:right-auto sm:top-full/, "Insights dropdown must use viewport insets on mobile and active-item anchoring on desktop")
  assert.match(nav, /mx-auto w-full max-w-\[360px\][\s\S]*sm:mx-0 sm:w-\[390px\]/, "Insights dropdown must cap its mobile width")
  assert.equal(nav.includes("backdrop-blur"), false, "parent menu should preserve the old visual hierarchy without persistent backdrop-filter blur")
  assert.equal(nav.includes("transition-all"), false, "parent menu should keep transitions bounded")
  assert.equal(nav.includes("label: \"Quét Wyckoff\""), false, "legacy research modules should stay consolidated under the research hub")
  assert.equal(nav.includes("label: \"Tín hiệu giao dịch\""), false, "legacy research modules should stay consolidated under the research hub")
})

test("shared shell typography follows the semantic scale while preserving ticker glow", () => {
  const layout = source("app/layout.tsx")
  const nav = source("components/top-nav.tsx")
  const stockIdentity = source("components/stock-identity.tsx")
  const councilCss = source("app/insights/ai-council/ai-council.module.css")

  assert.doesNotMatch(layout, /\bGeist\b/)
  assert.doesNotMatch(layout, /geistSans/)
  assert.match(layout, /Geist_Mono/)
  assert.match(layout, /Plus_Jakarta_Sans/)

  assert.match(nav, /font-ticker text-lg font-extrabold italic/)
  assert.match(nav, /font-ticker text-\[11px\] font-medium text-slate-400/)
  assert.doesNotMatch(nav, /text-\[17px\]|text-\[10\.5px\]/)
  assert.match(nav, /px-3\.5 py-1\.5 text-xs font-medium/)
  assert.match(nav, /text-sm font-bold tracking-tight/)
  assert.match(nav, /text-xs font-bold transition-colors/)
  assert.match(nav, /text-\[11px\] font-normal leading-snug/)

  for (const path of [
    "components/top-nav.tsx",
    "components/research/research-hub-nav.tsx",
    "components/admin/admin-header.tsx",
    "components/portfolio/portfolio-page.tsx",
  ]) {
    assert.doesNotMatch(source(path), /text-\[\d+\.5px\]/, `${path} should not use unexplained half-pixel font sizes in shared shells`)
  }

  assert.match(stockIdentity, /bg-gradient-to-br from-white via-cyan-100 to-emerald-200/)
  assert.match(stockIdentity, /drop-shadow-\[0_0_15px_rgba\(34,211,238,0\.2\)\]/)
  assert.doesNotMatch(councilCss, /:global\(\.font-mono\)\s*\{\s*font-family:/)
  assert.match(councilCss, /:global\(\.font-mono\)\s*\{\s*font-variant-numeric:/)
})

test("target UI surfaces avoid broad transitions and persistent blur without touching complex runtimes", () => {
  const button = source("components/ui/button.tsx")
  const badge = source("components/ui/badge.tsx")
  const tickerPage = source("app/research/[ticker]/page.tsx")
  const fa = source("components/research/fa-screen-app.tsx")
  const portfolioSelector = source("components/portfolio/portfolio-selector.tsx")
  const portfolioPage = source("components/portfolio/portfolio-page.tsx")

  assert.doesNotMatch(button, /transition-all/)
  assert.doesNotMatch(badge, /transition-all/)
  assert.doesNotMatch(tickerPage, /backdrop-blur/)
  assert.doesNotMatch(fa, /transition-all|backdrop-blur/)
  assert.doesNotMatch(portfolioSelector, /transition-all/)
  assert.doesNotMatch(portfolioPage, /transition-all/)
})

test("research hub lazy-loads heavy client apps inside client dynamic wrappers", () => {
  const page = source("app/research/page.tsx")
  assert.doesNotMatch(page, /from "next\/dynamic"/)
  assert.doesNotMatch(page, /ssr:\s*false/)

  const boundaries = [
    ["ResearchAppView", "research-app-view", "research-app", "ResearchApp"],
    ["ScannerAppView", "scanner-app-view", "scanner-app", "ScannerApp"],
    ["SignalsAppView", "signals-app-view", "signals-app", "SignalsApp"],
    ["FaScreenAppView", "fa-screen-app-view", "fa-screen-app", "FaScreenApp"],
  ] as const

  for (const [componentName, wrapperName, clientName, exportName] of boundaries) {
    assert.equal(
      page.includes(`from "@/components/research/${clientName}"`),
      false,
      `app/research/page.tsx must not import ${clientName}`,
    )
    assert.ok(
      page.includes(`import ${componentName} from "@/components/research/${wrapperName}"`),
      `${componentName} should be a small statically imported wrapper`,
    )

    const wrapper = source(`components/research/${wrapperName}.tsx`)
    assert.match(wrapper, /^["']use client["']/, `${wrapperName} must be a Client Component so next/dynamic can code-split the heavy client app`)
    assert.match(wrapper, /import nextDynamic from "next\/dynamic"/)
    assert.equal(
      wrapper.includes(`import { ${exportName} } from "@/components/research/${clientName}"`),
      false,
      `${wrapperName} must not statically import the heavy client app`,
    )
    assert.ok(
      wrapper.includes(`import("@/components/research/${clientName}").then((mod) => mod.${exportName})`),
      `${wrapperName} should dynamically import ${exportName}`,
    )
    assert.doesNotMatch(wrapper, /ssr:\s*false/, `${wrapperName} should preserve SSR while splitting client code`)
  }
})

test("legacy research sub-pages redirect into the single research route", () => {
  const redirects: Record<string, string> = {
    "app/research/scanner/page.tsx": "/research?view=scanner",
    "app/research/signals/page.tsx": "/research?view=signals",
    "app/research/fa/page.tsx": "/research?view=fa",
    "app/research/changes/page.tsx": "/research?view=changes",
    "app/research/log/page.tsx": "/research?view=log",
    "app/research/review/page.tsx": "/research?view=review",
  }

  for (const [path, destination] of Object.entries(redirects)) {
    const file = source(path)
    assert.match(file, /redirect\(/, `${path} should preserve backward compatibility with a redirect`)
    assert.ok(file.includes(destination), `${path} should redirect to ${destination}`)
  }

  const hub = source("components/research/research-hub-nav.tsx")
  for (const view of ["overview", "scanner", "signals", "fa", "changes", "log", "review"]) {
    assert.ok(hub.includes(`view: "${view}"`), `research hub should expose ${view}`)
  }
})

test("research routes have an immediate loading boundary", () => {
  const loading = source("app/research/loading.tsx")
  assert.match(loading, /TopNav/)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /animate-pulse/)
})

test("QEO-152 makes the authenticated root a four-destination homepage and moves legacy surfaces to canonical routes", () => {
  const home = source("app/page.tsx")
  const board = source("app/board/page.tsx")
  const reports = source("app/reports/page.tsx")
  const legacyReports = source("app/insights/reports/page.tsx")
  const nav = source("components/top-nav.tsx")
  const adminHeader = source("components/admin/admin-header.tsx")

  assert.match(home, /getServerAuthContext/)
  assert.match(home, /LandingLogin/)
  for (const href of ["/board", "/portfolio", "/insights", "/reports"]) {
    assert.ok(home.includes(`href: "${href}"`) || home.includes(`href="${href}"`), `homepage should expose ${href}`)
  }
  assert.match(home, /grid[^\n]*md:grid-cols-2/)
  assert.doesNotMatch(home, /transition-all|backdrop-blur|backdrop-filter|filter:/)

  assert.match(board, /MarketBoardFilterShell/)
  assert.match(board, /getCanonicalUniverse/)

  assert.match(reports, /alternates:\s*\{ canonical: "\/reports" \}/)
  assert.match(reports, /action="\/reports"/)
  assert.match(legacyReports, /redirect\("\/reports"\)/)

  assert.match(nav, /label: "Báo cáo Research",\s*href: "\/reports"/)
  assert.match(nav, /const isBoardActive = pathname\.startsWith\("\/board"\)/)
  assert.match(nav, /href="\/board"/)
  assert.match(adminHeader, /href="\/board"/)
})

test("QEO-154 homepage hover interaction zooms the active icon, reveals mini icons behind it, and blurs siblings", () => {
  const home = source("app/page.tsx")

  assert.match(home, /group\/home/, "homepage grid should coordinate sibling hover state without client hydration")
  assert.match(home, /group-hover\/home:blur-\[2px\]/, "non-hovered cards should use a light transient blur")
  assert.match(home, /group-hover\/home:opacity-40/, "non-hovered cards should dim while a sibling is active")
  assert.match(home, /hover:!blur-none/, "the active card must remain sharp")
  assert.match(home, /hover:!opacity-100/, "the active card must remain fully visible")
  assert.match(home, /group-hover\/card:scale-\[1\.12\]/, "the main icon should zoom on hover")
  assert.match(home, /z-0/, "mini icons should stay on the back layer")
  assert.match(home, /z-10/, "the main icon should stay above the mini icons")
  assert.match(home, /transition-\[opacity,transform\]/, "mini icons should animate with bounded properties")
  assert.doesNotMatch(home, /transition-all|backdrop-blur|backdrop-filter/, "homepage hover effect must preserve the performance contract")
})

test("QEO-155 homepage icon cluster matches the approved reference geometry and palette", () => {
  const home = source("app/page.tsx")

  assert.match(home, /data-home-mini-anchor/, "all satellites should share one exact center anchor")
  assert.match(home, /group-hover\/card:-translate-x-\[3\.625rem\]/, "left satellite should move 58px from the shared center")
  assert.match(home, /group-hover\/card:translate-x-\[3\.625rem\]/, "right satellite should move 58px from the shared center")
  assert.match(home, /group-hover\/card:-translate-y-\[1\.5rem\]/, "left and right satellites should share the same 24px upward offset")
  assert.match(home, /group-hover\/card:-translate-y-\[3\.75rem\]/, "top satellite should move 60px upward so the main tile partially overlaps it")
  assert.match(home, /group-hover\/card:-rotate-\[12deg\]/, "left satellite should tilt outward")
  assert.match(home, /group-hover\/card:rotate-\[12deg\]/, "right satellite should tilt outward symmetrically")
  assert.match(home, /h-10 w-10/, "satellite tiles should remain 40px square")
  assert.match(home, /bg-\[#1b1e24\]/, "satellite tiles should use the reference dark surface")
  assert.match(home, /border-\[#363b44\]/, "satellite tiles should use the reference subtle border")
  assert.match(home, /text-\[#b7f64d\]/, "satellite glyphs should use the reference lime accent")
  assert.match(home, /h-\[86px\] w-\[86px\]/, "main tile should be about 86px before hover zoom")
  assert.match(home, /group-hover\/card:scale-\[1\.12\]/, "main tile should zoom to roughly the 96px reference size")
  assert.match(home, /from-\[#e3f7a6\]/)
  assert.match(home, /via-\[#b7e54d\]/)
  assert.match(home, /to-\[#7bc20c\]/)
  assert.match(home, /text-\[#111317\]/, "main glyph should use the dark reference foreground")
  assert.match(home, /rounded-\[24px\]/, "main tile should keep the reference-like rounded silhouette while scaled")
  assert.match(home, /duration-\[420ms\]/, "satellite fan-out should use the approved smooth timing")
  assert.match(home, /ease-\[cubic-bezier\(0\.22,1,0\.36,1\)\]/, "zoom and fan-out should use the approved easing")
  assert.doesNotMatch(home, /transition-all|backdrop-blur|backdrop-filter/, "reference matching must preserve the homepage performance contract")
})
