import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { boundTickerChatHistory } from "../components/stock-detail/stock-ai-chat-state.ts"

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

test("QEO-195 separates consensus and confidence into two stat cards and removes conviction copy", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  assert.match(code, /data-ai-council-metrics/)
  assert.match(code, /grid-cols-2/)
  assert.match(code, /ĐỒNG THUẬN/)
  assert.match(code, /ĐỘ TIN CẬY/)
  assert.match(code, /\{consensus\}%/)
  assert.match(code, /\{confidence\}%/)
  assert.match(code, /\{activeTier\.label\}/)
  assert.doesNotMatch(code, /\{consensus\}% đồng thuận với độ tin cậy \{activeTier\.label\} \(\{confidence\}%\)/)
  assert.doesNotMatch(code, /Tăng conviction khi/)
  assert.doesNotMatch(code, /aiStock\?\.whatChangesDecision\?\.\[0\]/)
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

test("QEO-118 bounds ephemeral stock AI chat history to latest six normalized turns", () => {
  const bounded = boundTickerChatHistory([
    { role: "assistant", content: "  zero   " },
    ...Array.from({ length: 7 }, (_, index) => ({ role: "user" as const, content: `  turn   ${index}  ` })),
  ])
  assert.equal(bounded.length, 6)
  assert.equal(bounded[0]?.content, "turn 1")
  assert.equal(bounded[5]?.content, "turn 6")

  const long = boundTickerChatHistory([{ role: "user", content: "x".repeat(1_500) }])
  assert.equal(long[0]?.content.length, 1_200)
})

test("QEO-118 upgrades the existing Quick AI Assistant to the grounded ticker API", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")

  assert.match(code, /\/api\/insights\/\$\{encodeURIComponent\(ticker\)\}\/chat/)
  assert.match(code, /boundTickerChatHistory/)
  assert.match(code, /citations/)
  assert.match(code, /authority/)
  assert.match(code, /retrievalStatus/)
  assert.match(code, /limitation/)
  assert.match(code, /contradictions/)
  assert.doesNotMatch(code, /setTimeout\s*\(/)
  assert.doesNotMatch(code, /58\.4%|1\.35x/)
  assert.doesNotMatch(code, /Tôi nắm toàn diện/)
})

test("QEO-118 preset chips share handleSend and never fall back to local fabricated finance answers", () => {
  const code = source("components/stock-detail/stock-ai-sidebar.tsx")
  assert.match(code, /onClick=\{\(\) => handleSend\(/)
  assert.match(code, /fetch\(`/)
  assert.doesNotMatch(code, /q\.includes\("dòng tiền"\)|q\.includes\("hỗ trợ"\)|q\.includes\("wyckoff"\)/)
})
