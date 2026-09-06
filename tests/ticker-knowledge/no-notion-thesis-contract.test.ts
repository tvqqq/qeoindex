import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  TICKER_KNOWLEDGE_AUTHORITIES,
  TICKER_KNOWLEDGE_SOURCE_TYPES,
  TICKER_KNOWLEDGE_TYPES,
} from "../../modules/ticker-knowledge/domain.ts"

const retiredPattern = /\b(?:CURRENT_THESIS|THESIS_HISTORY|NOTION_THESIS|CANONICAL_THESIS|rebuild_theses)\b/

const activeSurfaces = [
  "../../app/api/admin/ticker-knowledge/acceptance/route.ts",
  "../../components/stock-detail/stock-ai-sidebar.tsx",
  "../../modules/ai-council/ticker-knowledge-runtime.ts",
  "../../modules/ticker-knowledge/context.ts",
  "../../modules/ticker-knowledge/domain.ts",
  "../../modules/ticker-knowledge/index.ts",
  "../../modules/ticker-knowledge/production-acceptance.ts",
  "../../modules/ticker-knowledge/projections.ts",
  "../../modules/ticker-knowledge/sync.ts",
  "../../modules/ticker-qa/canonical.ts",
  "../../modules/ticker-qa/mandatory.ts",
  "../../modules/ticker-qa/prompt.ts",
  "../../modules/ticker-qa/types.ts",
] as const

test("QEO-119 ticker knowledge domain excludes legacy Notion thesis concepts", () => {
  assert.equal(TICKER_KNOWLEDGE_TYPES.includes("CURRENT_THESIS" as never), false)
  assert.equal(TICKER_KNOWLEDGE_TYPES.includes("THESIS_HISTORY" as never), false)
  assert.equal(TICKER_KNOWLEDGE_SOURCE_TYPES.includes("NOTION_THESIS" as never), false)
  assert.equal(TICKER_KNOWLEDGE_AUTHORITIES.includes("CANONICAL_THESIS" as never), false)
})

test("QEO-119 active ticker knowledge and Stock Q&A surfaces stay free of retired thesis contracts", () => {
  for (const relativePath of activeSurfaces) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8")
    assert.doesNotMatch(source, retiredPattern, relativePath)
  }
})
