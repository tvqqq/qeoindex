import test from "node:test"
import assert from "node:assert/strict"

import { resolveTickerQaEvidence } from "../../modules/ticker-qa/canonical.ts"
import {
  createTickerKnowledgeItem,
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
} from "../../modules/ticker-knowledge/domain.ts"

const selected = createTickerKnowledgeItem({
  ticker: "MSN",
  knowledgeType: "REPORT_CHUNK",
  authority: "SOURCE_OPINION",
  sourceType: "RESEARCH_REPORT",
  logicalKey: "budgeted-report-chunk",
  text: "q".repeat(90),
  provenance: {
    sourceId: "report-budget",
    sourceVersion: `analysis-budget:${"a".repeat(64)}:chunk-v1`,
    reportId: "report-budget",
    analysisId: "analysis-budget",
    contentHash: "a".repeat(64),
    chunkVersion: "chunk-v1",
    chunkId: "22222222-2222-4222-8222-222222222222",
    page: 3,
    publishedAt: "2026-09-05",
    asOf: "2026-09-05",
  },
  projectionVersion: TICKER_KNOWLEDGE_PROJECTION_VERSION,
})

test("QEO-118 canonical hydration cannot expand a Context Builder bounded item", async () => {
  const canonicalText = `CANONICAL:${"x".repeat(500)}`
  const canonical = { ...selected, text: canonicalText }
  const result = await resolveTickerQaEvidence({} as never, "MSN", [selected], {
    loadReportCanonicalCandidates: async () => [canonical],
  })

  const evidence = result.evidence[0]
  assert.ok(evidence)
  assert.ok(evidence.text.startsWith("CANONICAL:"))
  assert.ok(evidence.text.length <= selected.text.length)
  assert.notEqual(evidence.text, canonicalText)
  assert.doesNotMatch(evidence.text, /^q+$/)
})
