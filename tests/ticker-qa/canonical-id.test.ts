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
  logicalKey: "report-1:analysis-1:chunk-1",
  text: "untrusted Qdrant copy",
  provenance: {
    sourceId: "report-1",
    sourceVersion: `analysis-1:${"a".repeat(64)}:chunk-v1`,
    reportId: "report-1",
    analysisId: "analysis-1",
    contentHash: "a".repeat(64),
    chunkVersion: "chunk-v1",
    chunkId: "11111111-1111-4111-8111-111111111111",
    page: 7,
    publishedAt: "2026-09-05",
    asOf: "2026-09-05",
  },
  projectionVersion: TICKER_KNOWLEDGE_PROJECTION_VERSION,
})

test("QEO-118 canonical evidence/citation IDs are source-derived, never Qdrant point IDs", async () => {
  const canonical = { ...selected, text: "canonical PostgreSQL report chunk" }
  const result = await resolveTickerQaEvidence({} as never, "MSN", [selected], {
    loadReportCanonicalCandidates: async () => [canonical],
  })

  const evidence = result.evidence[0]
  assert.ok(evidence)
  assert.doesNotMatch(evidence.evidenceId, /^tk:/)
  assert.doesNotMatch(evidence.citation?.id ?? "", /^tk:/)
  assert.match(evidence.evidenceId, /^report:/)
  assert.match(evidence.evidenceId, /report-1/)
  assert.match(evidence.evidenceId, /analysis-1/)
  assert.match(evidence.evidenceId, /11111111-1111-4111-8111-111111111111/)
})
