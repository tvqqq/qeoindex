import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

// Nested research-report tests are executed through the existing top-level AI
// suite. Keep QEO-85 focused contracts in the same nested execution chain.
import "./pricing.test.ts"
import "./ai-budget.test.ts"
import "./qeo85-schema.test.ts"
import "./lease.test.ts"
import "./topi.test.ts"

import {
  nextCitationNavigationState,
  type CitationNavigationState,
} from "../../components/research-reports/report-detail-navigation.ts"

function source(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
}

test("citation navigation always switches mobile state to PDF and requests the cited page", () => {
  const initial: CitationNavigationState = { activeTab: "analysis", requestedPage: null }
  assert.deepEqual(nextCitationNavigationState(initial, 7), {
    activeTab: "pdf",
    requestedPage: 7,
  })
  assert.deepEqual(initial, { activeTab: "analysis", requestedPage: null })
})

test("citation navigation from chat uses the same PDF page contract", () => {
  assert.deepEqual(
    nextCitationNavigationState({ activeTab: "chat", requestedPage: 2 }, 12),
    { activeTab: "pdf", requestedPage: 12 },
  )
})

test("non-positive or fractional citation pages are rejected", () => {
  const current: CitationNavigationState = { activeTab: "chat", requestedPage: null }
  assert.throws(() => nextCitationNavigationState(current, 0), /Invalid citation page/)
  assert.throws(() => nextCitationNavigationState(current, -1), /Invalid citation page/)
  assert.throws(() => nextCitationNavigationState(current, 1.5), /Invalid citation page/)
})

test("shared citation component exposes page context and delegates exactly one page number", () => {
  const code = source("components/research-reports/report-citation.tsx")
  assert.match(code, /aria-label=\{`Mở trang \$\{page\} của báo cáo`\}/)
  assert.match(code, /onNavigate\(page\)/)
  assert.match(code, /Trang \{page\}/)
  assert.doesNotMatch(code, /window\.open|location\.href|requestedPage/)
})

test("citation excerpt is visible context rather than hidden-only metadata", () => {
  const code = source("components/research-reports/report-citation.tsx")
  assert.match(code, /excerpt\s*\?/)
  assert.match(code, /title=\{excerpt/)
})
