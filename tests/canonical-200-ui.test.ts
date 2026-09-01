import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { boardSectorGroupForSector } from "../lib/market-sectors.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("board maps live KFSP sector taxonomy into all six board groups", () => {
  assert.equal(boardSectorGroupForSector("NGÂN HÀNG").key, "bank")
  assert.equal(boardSectorGroupForSector("CHỨNG KHOÁN").key, "securities")
  assert.equal(boardSectorGroupForSector("BẤT ĐỘNG SẢN").key, "real-estate")
  assert.equal(boardSectorGroupForSector("THƯƠNG MẠI").key, "consumer")
  assert.equal(boardSectorGroupForSector("THỰC PHẨM").key, "consumer")
  assert.equal(boardSectorGroupForSector("CÔNG NGHỆ").key, "industrial-tech")
  assert.equal(boardSectorGroupForSector("DẦU KHÍ").key, "other")
})

test("market bubbles render the canonical membership without a second liquidity cutoff", () => {
  const bubbles = source("components/insights/market-bubbles.tsx")
  const dashboard = source("components/insights/market-close-dashboard.tsx")

  assert.doesNotMatch(bubbles, /stock\.volume[^\n]*>\s*300_000/)
  assert.match(bubbles, /\[\.\.\.stocks\][\s\S]*\.sort\([\s\S]*\.slice\(0, 200\)/)
  assert.doesNotMatch(dashboard, /KLGD TB 50 phiên\s*&gt;\s*300\.000/)
  assert.match(dashboard, /canonical|Top Stocks|tối đa 200 mã/i)
})

test("Qeo Composite defaults to all canonical stocks and exposes sortable market cap", () => {
  const dashboard = source("components/insights/insights-dashboard.tsx")

  assert.doesNotMatch(dashboard, /useState<"top100"\s*\|\s*"all">/)
  assert.doesNotMatch(dashboard, /\["top100",\s*"Top 100"\]/)
  assert.doesNotMatch(dashboard, /showSectorGroups\s*=\s*universeFilter/)
  assert.match(dashboard, /"marketCapBillion"/)
  assert.match(dashboard, /sortKey="marketCapBillion"/)
  assert.match(dashboard, /Vốn h[oó]a/i)
  assert.match(dashboard, /const filteredRatings = useMemo\([\s\S]*return data\.ratings/)
})
