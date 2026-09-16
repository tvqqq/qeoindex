import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("QEO-172 initial Stock Detail SSR uses a chart-critical bootstrap instead of full ancillary data", () => {
  const page = source("app/insights/[ticker]/page.tsx")
  const critical = source("modules/research/insights/stock-detail-critical-data.ts")

  assert.match(page, /fetchStockDetailCriticalData\(decoded, auth\.supabase\)/)
  assert.doesNotMatch(page, /fetchStockDetailData\(decoded, auth\.supabase\)/)
  assert.match(page, /<StockDetailWorkstation data=\{stockDetailData\} hydrateInitialData \/>/)
  assert.match(critical, /export async function fetchStockDetailCriticalData/)
  assert.match(critical, /qeo172-critical-bootstrap/)
})

test("QEO-172 isolated critical SSR module excludes scanner research AI and rating cold loads", () => {
  const critical = source("modules/research/insights/stock-detail-critical-data.ts")

  assert.match(critical, /getChartOhlcv/)
  assert.match(critical, /resolution:\s*"1D"/)
  for (const blockingDependency of [
    "getCachedResearchData",
    "getCachedScannerData",
    "getStockDetailCouncilRuntime",
    "getTickerAiCouncilHistory",
    "getInsightsRatingForTicker",
  ]) {
    assert.doesNotMatch(critical, new RegExp(`\\b${blockingDependency}\\b`), `${blockingDependency} must stay off the chart-critical SSR module`)
  }
})

test("QEO-172 workstation hydrates full ancillary detail after first chart mount", () => {
  const workstation = source("components/stock-detail/stock-detail-workstation.tsx")
  assert.match(workstation, /hydrateInitialData/)
  assert.match(workstation, /requestIdleCallback/)
  assert.match(workstation, /getStockDetail\(initialData\.ticker,\s*\{\s*force:\s*true\s*\}\)/)
})
