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

test("research hub isolates view-specific client apps behind server dynamic boundaries", () => {
  const page = source("app/research/page.tsx")
  assert.match(page, /import nextDynamic from "next\/dynamic"/)
  assert.doesNotMatch(page, /ssr:\s*false/)

  const boundaries = [
    ["ResearchAppView", "research-app-view", "research-app"],
    ["ScannerAppView", "scanner-app-view", "scanner-app"],
    ["SignalsAppView", "signals-app-view", "signals-app"],
    ["FaScreenAppView", "fa-screen-app-view", "fa-screen-app"],
  ] as const

  for (const [componentName, wrapperName, clientName] of boundaries) {
    assert.equal(
      page.includes(`from "@/components/research/${clientName}"`),
      false,
      `app/research/page.tsx must not statically import ${clientName}`,
    )
    assert.ok(
      page.includes(`const ${componentName} = nextDynamic(() => import("@/components/research/${wrapperName}"))`),
      `${componentName} should be a top-level dynamic Server Component boundary`,
    )

    const wrapper = source(`components/research/${wrapperName}.tsx`)
    assert.doesNotMatch(wrapper, /["']use client["']/, `${wrapperName} must remain a Server Component wrapper`)
    assert.ok(wrapper.includes(`from "@/components/research/${clientName}"`), `${wrapperName} must own the client import`)
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
