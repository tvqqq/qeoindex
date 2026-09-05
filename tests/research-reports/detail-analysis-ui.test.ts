import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("analysis panel renders persisted analysis sections and explicit lifecycle states", () => {
  const analysis = source("components/research-reports/analysis-panel.tsx")

  assert.match(analysis, /executiveSummary/)
  assert.match(analysis, /keyPoints/)
  assert.match(analysis, /marketView/)
  assert.match(analysis, /sectorOutlook/)
  assert.match(analysis, /catalysts/)
  assert.match(analysis, /risks/)
  assert.match(analysis, /Đang xử lý phân tích/)
  assert.match(analysis, /needs_ocr|OCR/i)
  assert.match(analysis, /unsupported|chưa được hỗ trợ/i)
  assert.match(analysis, /Phân tích AI hiện chưa khả dụng/)
  assert.match(analysis, /Chưa có phân tích hiện hành/)
})

test("analysis presentation stays persisted-only and delegates ticker evidence", () => {
  const analysis = source("components/research-reports/analysis-panel.tsx")

  assert.match(analysis, /TickerMentionCard/)
  assert.match(analysis, /onNavigateCitation/)
  assert.doesNotMatch(analysis, /fetch\s*\(|openai|responses\.create|chat\/completions/i)
})

test("ticker card visibly labels broker values as report opinion and reuses shared citations", () => {
  const ticker = source("components/research-reports/ticker-mention-card.tsx")

  assert.match(ticker, /Quan điểm từ báo cáo/)
  assert.match(ticker, /recommendationText/)
  assert.match(ticker, /targetPrice/)
  assert.match(ticker, /targetCurrency/)
  assert.match(ticker, /rationale/)
  assert.match(ticker, /ReportCitation/)
  assert.match(ticker, /onNavigateCitation/)
  assert.match(ticker, /evidence/)
})

test("every ticker evidence citation delegates the exact persisted page and excerpt", () => {
  const ticker = source("components/research-reports/ticker-mention-card.tsx")

  assert.match(ticker, /page=\{evidence\.page\}/)
  assert.match(ticker, /excerpt=\{evidence\.snippet\}/)
  assert.match(ticker, /onNavigate=\{onNavigateCitation\}/)
})
