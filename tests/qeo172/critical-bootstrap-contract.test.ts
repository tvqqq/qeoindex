import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 initial Stock Detail SSR uses a chart-critical bootstrap instead of full ancillary data", () => {
  const page = source("app/insights/[ticker]/page.tsx")
  const data = source("modules/research/insights/stock-detail-data.ts")

  assert.match(page, /fetchStockDetailCriticalData\(decoded, auth\.supabase\)/)
  assert.doesNotMatch(page, /fetchStockDetailData\(decoded, auth\.supabase\)/)
  assert.match(data, /export async function fetchStockDetailCriticalData/)
  assert.match(data, /qeo172-critical-bootstrap/)
})

test("QEO-172 critical SSR path excludes scanner research AI and rating cold loads", () => {
  const data = source("modules/research/insights/stock-detail-data.ts")
  const start = data.indexOf("export async function fetchStockDetailCriticalData")
  const end = data.indexOf("export function buildFallbackRatingRow", start)
  assert.ok(start >= 0 && end > start, "critical bootstrap function must be present before fallback rating builder")
  const critical = data.slice(start, end)

  assert.match(critical, /getCanonicalDailySeed/)
  for (const blockingDependency of [
    "getCachedResearchData",
    "getCachedScannerData",
    "getStockDetailCouncilRuntime",
    "getTickerAiCouncilHistory",
    "getInsightsRatingForTicker",
  ]) {
    assert.doesNotMatch(critical, new RegExp(`\\b${blockingDependency}\\b`), `${blockingDependency} must stay off the chart-critical SSR path`)
  }
})

test("QEO-172 workstation hydrates full ancillary detail after first chart mount", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  assert.match(workstation, /hydrateInitialData/)
  assert.match(workstation, /requestIdleCallback/)
  assert.match(workstation, /getStockDetail\(initialData\.ticker,\s*\{\s*force:\s*true\s*\}\)/)
})
