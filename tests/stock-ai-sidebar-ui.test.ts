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

test("StockAiSidebar positions consensus badge with merged confidence and conviction description below donut", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  // Below donut, consensus badge displays consensus with confidence tier and percentage
  assert.match(code, /\{consensus\}% đồng thuận với độ tin cậy \{activeTier\.label\} \(\{confidence\}%\)/)
  assert.match(code, /Tăng conviction khi/)
})

test("StockAiSidebar updates 5 pillars title, applies confidence neon glow ring, and removes standalone slider", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  // 5 Pillars title updated
  assert.match(code, /5 Trụ cột đánh giá từ AI Council/)
  // Legacy "Hội đồng: {score}/100" header is removed
  assert.doesNotMatch(code, /Hội đồng:\s*\{score\}\/100/)

  // Standalone confidence spectrum slider track bar is removed
  assert.doesNotMatch(code, /0% Thấp/)
  assert.doesNotMatch(code, /100% Rất cao/)
  assert.doesNotMatch(code, /bg-gradient-to-r from-\[#f43f5e\] via-\[#3b82f6\] via-\[#eab308\] via-\[#f97316\] to-\[#10b981\]/)

  // Circular ring arc uses activeTier confidence gradient and neon glow filter
  assert.match(code, /stroke=\{`url\(#\$\{activeTier\.gradientId\}\)`\}/)
  assert.match(code, /filter="url\(#consensus-ring-glow\)"/)

  // Arc length is still driven by consensus
  assert.match(code, /strokeDashoffset=\{strokeDashoffset\}/)
})

test("Vùng kích hoạt & Quản trị is removed from sidebar and moved to Tab 6 in StockTabsPanel", () => {
  const sidebarCode = source("components/stock-detail/stock-ai-sidebar.tsx")
  const tabsCode = source("components/stock-detail/stock-tabs-panel.tsx")

  // Removed from sidebar
  assert.doesNotMatch(sidebarCode, /Vùng kích hoạt & Quản trị/)

  // Moved to Tab 6 with 3 sub-tabs and clean text UI (no progress bar charts)
  assert.match(tabsCode, /Vùng kích hoạt & Quản trị/)
  assert.match(tabsCode, /councilSubTab === "action"/)
  assert.match(tabsCode, /councilSubTab === "specialists"/)
  assert.match(tabsCode, /councilSubTab === "audit"/)
  assert.match(tabsCode, /Vùng Hỗ trợ/)
  assert.match(tabsCode, /Vùng Kháng cự/)
  assert.match(tabsCode, /Dừng lỗ & Vô hiệu/)
})
