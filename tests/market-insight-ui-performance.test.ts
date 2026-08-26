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
