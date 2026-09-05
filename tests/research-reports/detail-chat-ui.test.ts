import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { boundChatHistory } from "../../components/research-reports/report-chat-state.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

function makeHistory(turns: number, chars: number) {
  return Array.from({ length: turns }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `${index} ${"x".repeat(chars)}`,
  }))
}

test("history sent to backend never exceeds six turns or 1200 chars per turn", () => {
  const bounded = boundChatHistory(makeHistory(10, 2_000))
  assert.ok(bounded.length <= 6)
  assert.ok(bounded.every((turn) => turn.content.length <= 1_200))
  assert.deepEqual(bounded.map((turn) => turn.role), ["user", "assistant", "user", "assistant", "user", "assistant"])
})

test("chat history normalization drops blanks and collapses whitespace before bounding", () => {
  const bounded = boundChatHistory([
    { role: "user", content: "   " },
    { role: "assistant", content: "  grounded   answer  " },
  ])
  assert.deepEqual(bounded, [{ role: "assistant", content: "grounded answer" }])
})

test("chat posts only report id question and bounded history to the existing QEO-82 route", () => {
  const chat = source("components/research-reports/report-chat.tsx")

  assert.match(chat, /\/api\/research-reports\/\$\{encodeURIComponent\(reportId\)\}\/chat/)
  assert.match(chat, /method:\s*["']POST["']/)
  assert.match(chat, /Content-Type["']?:\s*["']application\/json["']/)
  assert.match(chat, /JSON\.stringify\(\{\s*question[\s\S]*history:\s*boundChatHistory\(history\)/)
  assert.doesNotMatch(chat, /localStorage|sessionStorage|indexedDB/i)
})

test("chat keeps prior turns visible, allows only one in-flight submit, and isolates local errors", () => {
  const chat = source("components/research-reports/report-chat.tsx")

  assert.match(chat, /isSubmitting/)
  assert.match(chat, /disabled=\{[^}]*isSubmitting/)
  assert.match(chat, /setMessages\(\(current\)\s*=>\s*\[\.\.\.current/)
  assert.doesNotMatch(chat, /setMessages\(\[\]\)/)
  assert.match(chat, /setErrorMessage/)
  assert.match(chat, /report_not_ready/)
  assert.match(chat, /chưa sẵn sàng/i)
  assert.match(chat, /tạm thời|temporarily/i)
})

test("not_found renders canonical no-evidence wording with zero citations", () => {
  const chat = source("components/research-reports/report-chat.tsx")

  assert.match(chat, /result\.status\s*===\s*["']not_found["']/)
  assert.match(chat, /Không tìm thấy thông tin này trong báo cáo\./)
  assert.match(chat, /citations:\s*\[\]/)
})

test("answered chat citations reuse shared page navigation", () => {
  const chat = source("components/research-reports/report-chat.tsx")

  assert.match(chat, /ReportCitation/)
  assert.match(chat, /page=\{citation\.page\}/)
  assert.match(chat, /excerpt=\{citation\.excerpt\}/)
  assert.match(chat, /onNavigate=\{onNavigateCitation\}/)
})
