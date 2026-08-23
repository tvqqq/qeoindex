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

test("Wyckoff chart shell avoids eager route work and compositor-heavy header filters", () => {
  const file = source("components/insights/wyckoff-chart-dashboard.tsx")

  assert.equal(file.includes("backdrop-blur-2xl"), false, "full-width Wyckoff header must not use backdrop-filter blur")
  assert.equal(file.includes("drop-shadow-["), false, "Wyckoff header must not add CSS filter drop-shadows around the chart canvas")
  assert.equal(file.includes("transition-all"), false, "Wyckoff header interactions should transition only paint-safe properties")

  const headerStart = file.indexOf("<header")
  const headerEnd = file.indexOf("</header>", headerStart)
  assert.notEqual(headerStart, -1)
  assert.notEqual(headerEnd, -1)

  const header = file.slice(headerStart, headerEnd)
  const links = header.match(/<Link[\s\S]*?<\/Link>/g) ?? []
  assert.ok(links.length >= 3, "Wyckoff header should keep its Insights/research navigation")
  for (const link of links) {
    assert.match(link, /prefetch=\{false\}/, "Wyckoff header links must not prefetch heavy dynamic routes while the chart mounts")
  }
})

test("research routes have an immediate loading boundary", () => {
  const loading = source("app/research/loading.tsx")
  assert.match(loading, /TopNav/)
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /animate-pulse/)
})
