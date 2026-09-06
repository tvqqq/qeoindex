import assert from "node:assert/strict"
import test from "node:test"

import {
  TICKER_KNOWLEDGE_AUTHORITIES,
  TICKER_KNOWLEDGE_SOURCE_TYPES,
  TICKER_KNOWLEDGE_TYPES,
} from "../../modules/ticker-knowledge/domain.ts"

test("QEO-119 ticker knowledge domain excludes legacy Notion thesis concepts", () => {
  assert.equal(TICKER_KNOWLEDGE_TYPES.includes("CURRENT_THESIS" as never), false)
  assert.equal(TICKER_KNOWLEDGE_TYPES.includes("THESIS_HISTORY" as never), false)
  assert.equal(TICKER_KNOWLEDGE_SOURCE_TYPES.includes("NOTION_THESIS" as never), false)
  assert.equal(TICKER_KNOWLEDGE_AUTHORITIES.includes("CANONICAL_THESIS" as never), false)
})
