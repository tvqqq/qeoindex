import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("StockAiSidebar donut chart formats recommendation cleanly without clutter", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  // Helper formatSignalLines splits recommendation across lines
  assert.match(code, /formatSignalLines/)
  assert.match(code, /formatSignalLines\(signalText\)/)

  // Donut center renders mapped lines
  assert.match(code, /signalLines\.map\(\(line, idx\)/)
})

test("StockAiSidebar positions consensus badge with conviction description below donut", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  // Below donut, consensus badge sits with conviction text
  assert.match(code, /\{consensus\}% Đồng thuận/)
  assert.match(code, /Tăng conviction khi/)
})

test("StockAiSidebar confidence section removes tiered legend list", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  // Confidence spectrum track exists
  assert.match(code, /Độ tin cậy \(Confidence\)/)
  assert.match(code, /bg-gradient-to-r from-\[#f43f5e\]/)

  // Legacy legend list with CONFIDENCE_TIERS.map is removed
  assert.doesNotMatch(code, /CONFIDENCE_TIERS\.map/)
})

test("StockAiSidebar restyles Vùng kích hoạt & Quản trị to match 5 pillars vibes", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  // Matches 5 pillars container styling
  assert.match(code, /Vùng kích hoạt & Quản trị/)
  assert.match(code, /rounded-xl border border-white\/\[0\.05\] bg-black\/20 p-3/)

  // Horizontal gradient bars for levels
  assert.match(code, /from-emerald-500 to-teal-400/)
  assert.match(code, /from-amber-500 to-yellow-400/)
  assert.match(code, /from-rose-500 to-pink-500/)

  // Invalidation note supported
  assert.match(code, /stopLossParsed\.note/)
  assert.match(code, /Vô hiệu:/)
})
