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

  // Keep this check compatible with the repository TypeScript target. Do not use
  // the RegExp dotAll (`s`) flag here; it requires ES2018 and breaks Vercel typecheck.
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
    assert.equal(
      file.includes(forbiddenDynamicResearchHref),
      false,
      `${path} must not auto-prefetch dynamic ticker routes`,
    )
  }
})

test("Wyckoff chart shell avoids eager route work and compositor-heavy navigation effects", () => {
  const file = source("components/insights/wyckoff-chart-dashboard.tsx")

  assert.equal(file.includes("backdrop-blur-2xl"), false, "Wyckoff workspace must not use backdrop-filter blur")
  assert.equal(file.includes("drop-shadow-["), false, "Wyckoff workspace must not add CSS filter drop-shadows around the chart canvas")
  assert.equal(file.includes("transition-all"), false, "Wyckoff interactions should transition only paint-safe properties")

  const backRowStart = file.indexOf("data-wyckoff-back-row")
  const headerStart = file.indexOf("<header", backRowStart)
  assert.notEqual(backRowStart, -1, "Wyckoff Rating navigation should live in its own row")
  assert.notEqual(headerStart, -1)

  const backRow = file.slice(backRowStart, headerStart)
  const links = backRow.match(/<Link[\s\S]*?<\/Link>/g) ?? []
  assert.ok(links.length >= 1, "Wyckoff back row should keep its Rating navigation link")
  for (const link of links) {
    assert.match(link, /prefetch=\{false\}/, "Wyckoff navigation must not prefetch the heavy dynamic route while the chart mounts")
  }

  const headerEnd = file.indexOf("</header>", headerStart)
  assert.notEqual(headerEnd, -1)
  const header = file.slice(headerStart, headerEnd)
  assert.doesNotMatch(header, /<Link/, "Rating navigation must stay outside the stock identity header")
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
  assert.equal(nav.includes("backdrop-blur"), false, "parent menu should preserve the old visual hierarchy without persistent backdrop-filter blur")
  assert.equal(nav.includes("transition-all"), false, "parent menu should keep transitions bounded")
  assert.equal(nav.includes("label: \"Quét Wyckoff\""), false, "legacy research modules should stay consolidated under the research hub")
  assert.equal(nav.includes("label: \"Tín hiệu giao dịch\""), false, "legacy research modules should stay consolidated under the research hub")
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
