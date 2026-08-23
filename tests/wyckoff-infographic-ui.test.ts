import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = readFileSync("app/insights/wyckoff/page.tsx", "utf8")
const infographic = readFileSync("components/insights/wyckoff-infographic-dashboard.tsx", "utf8")

test("standalone Wyckoff page routes to the infographic dashboard", () => {
  assert.match(page, /WyckoffInfographicDashboard/)
  assert.match(page, /dataSource="Supabase unified"/)
  assert.doesNotMatch(page, /return <WyckoffChartDashboard/)
})

test("Wyckoff infographic uses Plus Jakarta and shadcn primitives", () => {
  assert.match(infographic, /font-ticker/)
  assert.match(infographic, /@\/components\/ui\/card/)
  assert.match(infographic, /@\/components\/ui\/badge/)
  assert.match(infographic, /@\/components\/ui\/button/)
  assert.match(infographic, /@\/components\/ui\/input/)
})

test("Wyckoff infographic exposes decision, evidence, and multi-horizon modules", () => {
  assert.match(infographic, /Vùng giá then chốt/)
  assert.match(infographic, /Break/)
  assert.match(infographic, /Hold/)
  assert.match(infographic, /Follow-through/)
  assert.match(infographic, /Wyckoff signals & evidence/)
  assert.match(infographic, /Kịch bản theo thời gian/)
  assert.match(infographic, /outlooks=\{current\.outlooks\}/)
  assert.match(infographic, /1D đại diện tuần/)
  assert.match(infographic, /1W đại diện tháng/)
  assert.match(infographic, /1M đại diện dài hạn/)
})

test("infographic keeps the existing persistent lightweight chart surface", () => {
  assert.match(infographic, /<WyckoffLightweightChart/)
  assert.doesNotMatch(infographic, /LazyMotion|AnimatePresence|motion\/react/)
  assert.doesNotMatch(infographic, /backdrop-blur|backdrop-filter/)
})
