import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

const page = source("app/insights/wyckoff/page.tsx")
const deferred = source("components/insights/wyckoff-deferred-dashboard.tsx")
const dashboard = source("components/insights/wyckoff-daily-weekly-dashboard.tsx")
const chart = source("components/insights/wyckoff-lightweight-chart.tsx")
const unified = source("lib/wyckoff-unified-data.ts")

test("standalone Wyckoff page renders canonical shell and defers the Daily Weekly dashboard", () => {
  assert.match(page, /WyckoffDeferredDashboard/)
  assert.match(page, /getCanonicalUniverse/)
  assert.match(deferred, /dynamic\(/)
  assert.match(deferred, /wyckoff-daily-weekly-dashboard/)
  assert.match(deferred, /ssr:\s*false/)
  assert.match(deferred, /requestAnimationFrame/)
  assert.match(deferred, /AbortController/)
  assert.match(deferred, /Daily\/Weekly chart tải sau paint/)
})

test("Daily Weekly structure lab uses the compact shadcn surface", () => {
  assert.match(dashboard, /font-ticker/)
  assert.match(dashboard, /@\/components\/ui\/card/)
  assert.match(dashboard, /@\/components\/ui\/badge/)
  assert.match(dashboard, /@\/components\/ui\/button/)
  assert.match(dashboard, /@\/components\/ui\/input/)
  assert.doesNotMatch(dashboard, /TooltipContent|TooltipTrigger|<Tooltip>/)
  assert.doesNotMatch(dashboard, /font-mono/)
})

test("standalone Wyckoff keeps structure, decision levels and price-volume evidence", () => {
  assert.match(dashboard, /Price × Volume × Wyckoff/)
  assert.match(dashboard, /Cấu trúc \{activeTimeframe\}/)
  assert.match(dashboard, /Decision levels/)
  assert.match(dashboard, />Support</)
  assert.match(dashboard, />Resistance</)
  assert.match(dashboard, /Invalidation:/)
  assert.match(dashboard, /showIntelligence=\{false\}/)
  assert.match(dashboard, /showScenarios=\{false\}/)
})

test("watchlist and toolbar expose exactly Daily and Weekly", () => {
  assert.match(dashboard, /grid-cols-\[72px_1fr_1fr\]/)
  assert.match(dashboard, /phaseFor\(stock, "1D"\)/)
  assert.match(dashboard, /phaseFor\(stock, "1W"\)/)
  assert.match(dashboard, /\(\["1D", "1W"\] as const\)/)
  assert.match(dashboard, /Daily \+ Weekly/)
  assert.doesNotMatch(dashboard, /phase1H|phaseFor\(stock, "1H"\)|"4H"|"1M"/)
})

test("Daily Weekly dashboard keeps a persistent lightweight chart surface", () => {
  assert.match(dashboard, /<WyckoffLightweightChart/)
  assert.match(chart, /controllerRef/)
  assert.match(chart, /controller\.candles\.setData/)
  assert.match(chart, /controller\.volume\.setData/)
})

test("read model requests only 1D and 1W Wyckoff structures", () => {
  assert.match(unified, /\["1D", "1W"\]/)
  assert.doesNotMatch(unified, /phase1H/)
})
