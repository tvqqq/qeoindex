import test from "node:test"
import assert from "node:assert/strict"

import type { TickerQaResolvedEvidence } from "../../modules/ticker-qa/canonical.ts"
import { validateTickerQaModelOutput } from "../../modules/ticker-qa/schema.ts"
import { projectTickerQaModelOutput } from "../../modules/ticker-qa/service.ts"
import {
  createTickerKnowledgeItem,
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
} from "../../modules/ticker-knowledge/domain.ts"

function resolvedEvidence(input: {
  authority: "SOURCE_OPINION" | "DETERMINISTIC_SIGNAL"
  sourceType: "RESEARCH_REPORT" | "AI_COUNCIL"
  knowledgeType: "BROKER_VIEW" | "COUNCIL_MEMORY"
  logicalKey: string
  text: string
  reportId?: string
  runId?: string
}): TickerQaResolvedEvidence {
  const item = createTickerKnowledgeItem({
    ticker: "MSN",
    knowledgeType: input.knowledgeType,
    authority: input.authority,
    sourceType: input.sourceType,
    logicalKey: input.logicalKey,
    text: input.text,
    provenance: {
      sourceId: input.reportId ?? input.runId ?? input.logicalKey,
      sourceVersion: `${input.logicalKey}-v1`,
      reportId: input.reportId ?? null,
      analysisId: input.reportId ? "analysis-1" : null,
      contentHash: input.reportId ? "c".repeat(64) : "d".repeat(64),
      chunkVersion: input.reportId ? "chunk-v1" : null,
      runId: input.runId ?? null,
      asOf: "2026-09-05",
      publishedAt: "2026-09-05",
    },
    projectionVersion: TICKER_KNOWLEDGE_PROJECTION_VERSION,
  })
  return {
    evidenceId: `tk:${item.id}`,
    item,
    text: item.text,
    citation: {
      id: `tk:${item.id}`,
      sourceType: input.sourceType,
      authority: input.authority,
      label: input.sourceType === "RESEARCH_REPORT" ? "Research Report" : "AI Council · 2026-09-05",
      excerpt: input.text,
      href: input.reportId ? `/research/reports/${input.reportId}` : null,
      reportId: input.reportId,
      runId: input.runId,
      sourceVersion: item.provenance.sourceVersion,
    },
  }
}

const broker = resolvedEvidence({
  authority: "SOURCE_OPINION",
  sourceType: "RESEARCH_REPORT",
  knowledgeType: "BROKER_VIEW",
  logicalKey: "broker",
  reportId: "report-1",
  text: "HSBC source opinion: target price 110000 VND based on earnings recovery.",
})
const council = resolvedEvidence({
  authority: "DETERMINISTIC_SIGNAL",
  sourceType: "AI_COUNCIL",
  knowledgeType: "COUNCIL_MEMORY",
  logicalKey: "council",
  runId: "run-1",
  text: "AI Council deterministic signal is WAIT with risk status caution.",
})
const evidence = [broker, council]

test("QEO-118 validates authority-preserving grounded claims and explicit contradictions", () => {
  const output = validateTickerQaModelOutput({
    status: "answered",
    claims: [
      {
        text: "HSBC đặt mục tiêu 110.000 đồng theo quan điểm của nguồn báo cáo.",
        authority: "SOURCE_OPINION",
        citations: [{ evidenceId: broker.evidenceId, excerpt: "target price 110000 VND" }],
      },
      {
        text: "Council hiện vẫn ở trạng thái WAIT.",
        authority: "DETERMINISTIC_SIGNAL",
        citations: [{ evidenceId: council.evidenceId, excerpt: "deterministic signal is WAIT" }],
      },
    ],
    contradictions: [{
      leftEvidenceId: broker.evidenceId,
      rightEvidenceId: council.evidenceId,
      explanation: "Broker upside view conflicts with the current deterministic WAIT state.",
    }],
  }, evidence)

  assert.equal(output.status, "answered")
  assert.equal(output.claims[0]?.authority, "SOURCE_OPINION")
  assert.equal(output.claims[1]?.authority, "DETERMINISTIC_SIGNAL")
  assert.equal(output.contradictions.length, 1)
})

test("QEO-118 rejects unknown evidence IDs, ungrounded excerpts and authority laundering", () => {
  assert.throws(() => validateTickerQaModelOutput({
    status: "answered",
    claims: [{
      text: "Invented claim",
      authority: "SOURCE_OPINION",
      citations: [{ evidenceId: "tk:unknown", excerpt: "target price 110000 VND" }],
    }],
    contradictions: [],
  }, evidence), /outside the resolved evidence set/)

  assert.throws(() => validateTickerQaModelOutput({
    status: "answered",
    claims: [{
      text: "Invented excerpt",
      authority: "SOURCE_OPINION",
      citations: [{ evidenceId: broker.evidenceId, excerpt: "not present in canonical evidence" }],
    }],
    contradictions: [],
  }, evidence), /not grounded in canonical evidence/)

  assert.throws(() => validateTickerQaModelOutput({
    status: "answered",
    claims: [{
      text: "Broker opinion presented as verified fact",
      authority: "VERIFIED_FACT",
      citations: [{ evidenceId: broker.evidenceId, excerpt: "target price 110000 VND" }],
    }],
    contradictions: [],
  }, evidence), /authority does not match cited evidence/)
})

test("QEO-118 allows labeled AI inference only when it still cites canonical evidence", () => {
  const output = validateTickerQaModelOutput({
    status: "answered",
    claims: [{
      text: "Inference: broker upside is not yet confirmed by deterministic state.",
      authority: "AI_INFERENCE",
      citations: [
        { evidenceId: broker.evidenceId, excerpt: "target price 110000 VND" },
        { evidenceId: council.evidenceId, excerpt: "deterministic signal is WAIT" },
      ],
    }],
    contradictions: [],
  }, evidence)
  assert.equal(output.claims[0]?.authority, "AI_INFERENCE")
})

test("QEO-118 not_found must contain no claims or contradictions", () => {
  assert.deepEqual(
    validateTickerQaModelOutput({ status: "not_found", claims: [], contradictions: [] }, evidence),
    { status: "not_found", claims: [], contradictions: [] },
  )
  assert.throws(() => validateTickerQaModelOutput({
    status: "not_found",
    claims: [{
      text: "not allowed",
      authority: "SOURCE_OPINION",
      citations: [{ evidenceId: broker.evidenceId, excerpt: "target price 110000 VND" }],
    }],
    contradictions: [],
  }, evidence), /not_found output must contain zero claims/)
})

test("QEO-118 result projection preserves canonical citation metadata and claim authority", () => {
  const validated = validateTickerQaModelOutput({
    status: "answered",
    claims: [{
      text: "HSBC đặt mục tiêu 110.000 đồng.",
      authority: "SOURCE_OPINION",
      citations: [{ evidenceId: broker.evidenceId, excerpt: "target price 110000 VND" }],
    }],
    contradictions: [],
  }, evidence)

  const result = projectTickerQaModelOutput("MSN", validated, evidence, {
    retrievalStatus: "ready",
    limitation: null,
    audit: null,
  })

  assert.equal(result.status, "answered")
  assert.equal(result.claims[0]?.authority, "SOURCE_OPINION")
  assert.equal(result.citations[0]?.href, "/research/reports/report-1")
  assert.equal(result.citations[0]?.excerpt, "target price 110000 VND")
})
