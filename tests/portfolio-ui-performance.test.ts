import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const files = [
  "components/portfolio/portfolio-page.tsx",
  "components/portfolio/portfolio-positions-table.tsx",
  "components/portfolio/portfolio-allocation-chart.tsx",
  "components/portfolio/watchlist-panel.tsx",
]

test("portfolio workspace keeps dense UI performance guardrails", () => {
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n")
  assert.doesNotMatch(source, /backdrop-(?:blur|filter)/)
  assert.doesNotMatch(source, /transition-all/)
  assert.doesNotMatch(source, /filter:\s*(?:blur|drop-shadow)/)
})

test("portfolio ticker links do not trigger viewport prefetch fan-out", () => {
  const positions = readFileSync("components/portfolio/portfolio-positions-table.tsx", "utf8")
  const watchlist = readFileSync("components/portfolio/watchlist-panel.tsx", "utf8")
  assert.match(positions, /prefetch=\{false\}/)
  assert.match(watchlist, /prefetch=\{false\}/)
})
