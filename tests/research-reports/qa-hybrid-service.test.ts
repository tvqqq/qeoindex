import assert from "node:assert/strict"
import test from "node:test"

import { evaluateResearchReportQaRetrieval } from "../../modules/research-reports/qa/evaluation.ts"
import {
  answerResearchReportQuestion,
  type ResearchReportQaRetrievalComparison,
} from "../../modules/research-reports/qa/service.ts"
import type {
  ResearchReportQaAudit,
  ResearchReportQaEvidence,
  ResearchReportQaEvidenceIdentity,
  ResearchReportQaRetrievalClient,
} from "../../modules/research-reports/qa/types.ts"

const REPORT_ID = "11111111-1111-4111-8111-111111111111"
const HASH = "a".repeat(64)
const IDENTITY: ResearchReportQaEvidenceIdentity = {
  reportId: REPORT_ID,
  contentHash: HASH,
  chunkVersion: "report-chunk-v1",
  analysisId: "33333333-3333-4333-8333-333333333333",
}
const LEXICAL: ResearchReportQaEvidence = {
  evidenceId: `rr:${HASH.slice(0, 12)}:report-chunk-v1:44444444-4444-4444-8444-444444444444`,
  chunkId: "44444444-4444-4444-8444-444444444444",
  reportId: REPORT_ID,
  contentHash: HASH,
  chunkVersion: "report-chunk-v1",
  page: 7,
  chunkIndex: 0,
  content: "Lexical canonical evidence",
  rank: 0.7,
}
const HYBRID: ResearchReportQaEvidence = {
  evidenceId: `rr:${HASH.slice(0, 12)}:report-chunk-v1:55555555-5555-4555-8555-555555555555`,
  chunkId: "55555555-5555-4555-8555-555555555555",
  reportId: REPORT_ID,
  contentHash: HASH,
  chunkVersion: "report-chunk-v1",
  page: 9,
  chunkIndex: 0,
  content: "Hybrid canonical hydrated evidence",
  rank: 1,
}
const AUDIT: ResearchReportQaAudit = {
  promptVersion: "report-qa-prompt-v1",
  requestedModel: "test",
  responseModel: "test",
  fallbackUsed: false,
  attemptedModels: ["test"],
  responseId: "resp-test",
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
  latencyMs: 1,
  estimatedCostUsd: null,
  pricingVersion: null,
}

const client = {} as ResearchReportQaRetrievalClient

function answerCapturingEvidence(captured: ResearchReportQaEvidence[][]) {
  return async (input: { evidence: readonly ResearchReportQaEvidence[] }) => {
    captured.push([...input.evidence])
    return {
      output: { status: "not_found" as const, claims: [] },
      audit: AUDIT,
      route: null,
    }
  }
}

function assertMeasuredLatency(value: number) {
  assert.equal(Number.isFinite(value), true)
  assert.ok(value >= 0)
}

test("QEO-116 shadow mode measures latency + canonical hydration loss but keeps lexical evidence as user-visible authority", async () => {
  const captured: ResearchReportQaEvidence[][] = []
  const metrics: ResearchReportQaRetrievalComparison[] = []
  let hybridCalls = 0

  await answerResearchReportQuestion(client, {
    reportId: REPORT_ID,
    question: "mục tiêu định giá?",
  }, {
    resolveIdentity: async () => ({ status: "ready" as const, identity: IDENTITY }),
    retrieveEvidence: async () => [LEXICAL],
    retrieveHybridEvidence: async () => {
      hybridCalls += 1
      return {
        status: "ready" as const,
        evidence: [HYBRID],
        pointIds: ["point-1", "point-2"],
        retrievalMs: 12,
        hydrationMs: 4,
      }
    },
    retrievalMode: "shadow",
    recordRetrievalComparison: (metric) => { metrics.push(metric) },
    answerWithAi: answerCapturingEvidence(captured),
  })

  assert.equal(hybridCalls, 1)
  assert.deepEqual(captured[0].map((row) => row.chunkId), [LEXICAL.chunkId])
  assert.equal(metrics.length, 1)
  assertMeasuredLatency(metrics[0].lexicalMs)
  assert.deepEqual({ ...metrics[0], lexicalMs: 0 }, {
    mode: "shadow",
    selected: "lexical",
    fallbackUsed: false,
    lexicalCount: 1,
    lexicalMs: 0,
    hybridPointCount: 2,
    hybridCanonicalCount: 1,
    hybridCount: 1,
    hybridRetrievalMs: 12,
    hybridHydrationMs: 4,
    hybridResolutionRatio: 0.5,
    overlapCount: 0,
    overlapRatio: 0,
    hybridStatus: "ready",
  })
})

test("QEO-116 hybrid mode selects canonical hydrated evidence while keeping lexical shadow comparison", async () => {
  const captured: ResearchReportQaEvidence[][] = []
  const metrics: ResearchReportQaRetrievalComparison[] = []

  await answerResearchReportQuestion(client, {
    reportId: REPORT_ID,
    question: "mục tiêu định giá?",
  }, {
    resolveIdentity: async () => ({ status: "ready" as const, identity: IDENTITY }),
    retrieveEvidence: async () => [LEXICAL],
    retrieveHybridEvidence: async () => ({
      status: "ready" as const,
      evidence: [HYBRID],
      pointIds: ["point-1"],
      retrievalMs: 8,
      hydrationMs: 3,
    }),
    retrievalMode: "hybrid",
    recordRetrievalComparison: (metric) => { metrics.push(metric) },
    answerWithAi: answerCapturingEvidence(captured),
  })

  assert.deepEqual(captured[0].map((row) => row.chunkId), [HYBRID.chunkId])
  assertMeasuredLatency(metrics[0].lexicalMs)
  assert.deepEqual({ ...metrics[0], lexicalMs: 0 }, {
    mode: "hybrid",
    selected: "hybrid",
    fallbackUsed: false,
    lexicalCount: 1,
    lexicalMs: 0,
    hybridPointCount: 1,
    hybridCanonicalCount: 1,
    hybridCount: 1,
    hybridRetrievalMs: 8,
    hybridHydrationMs: 3,
    hybridResolutionRatio: 1,
    overlapCount: 0,
    overlapRatio: 0,
    hybridStatus: "ready",
  })
})

test("QEO-116 hybrid mode falls back to bounded lexical evidence when Qdrant is unavailable", async () => {
  const captured: ResearchReportQaEvidence[][] = []
  const metrics: ResearchReportQaRetrievalComparison[] = []

  await answerResearchReportQuestion(client, {
    reportId: REPORT_ID,
    question: "mục tiêu định giá?",
  }, {
    resolveIdentity: async () => ({ status: "ready" as const, identity: IDENTITY }),
    retrieveEvidence: async () => [LEXICAL],
    retrieveHybridEvidence: async () => ({
      status: "unavailable" as const,
      evidence: [] as const,
      pointIds: [] as const,
      reason: "qdrant_unavailable" as const,
      retrievalMs: 7,
      hydrationMs: 0 as const,
    }),
    retrievalMode: "hybrid",
    recordRetrievalComparison: (metric) => { metrics.push(metric) },
    answerWithAi: answerCapturingEvidence(captured),
  })

  assert.deepEqual(captured[0].map((row) => row.chunkId), [LEXICAL.chunkId])
  assertMeasuredLatency(metrics[0].lexicalMs)
  assert.deepEqual({ ...metrics[0], lexicalMs: 0 }, {
    mode: "hybrid",
    selected: "lexical",
    fallbackUsed: true,
    lexicalCount: 1,
    lexicalMs: 0,
    hybridPointCount: 0,
    hybridCanonicalCount: 0,
    hybridCount: 0,
    hybridRetrievalMs: 7,
    hybridHydrationMs: 0,
    hybridResolutionRatio: 0,
    overlapCount: 0,
    overlapRatio: 0,
    hybridStatus: "unavailable",
  })
})

test("QEO-116 offline evaluation proves semantic paraphrase recall improves without regressing Vietnamese lexical anchors", () => {
  const evaluation = evaluateResearchReportQaRetrieval([
    {
      id: "lexical-number-anchor",
      kind: "lexical_anchor",
      expectedChunkIds: ["chunk-a"],
      lexicalChunkIds: ["chunk-a", "noise-a"],
      hybridChunkIds: ["chunk-a", "noise-b"],
      qdrantCandidateCount: 2,
      canonicalHybridCount: 2,
      lexicalMs: 5,
      hybridRetrievalMs: 9,
      hybridHydrationMs: 3,
      citationValidity: "pass",
      answerQuality: "pass",
    },
    {
      id: "semantic-paraphrase-improvement",
      kind: "semantic_paraphrase",
      expectedChunkIds: ["chunk-b"],
      lexicalChunkIds: ["noise-c"],
      hybridChunkIds: ["chunk-b", "noise-d"],
      qdrantCandidateCount: 2,
      canonicalHybridCount: 2,
      lexicalMs: 4,
      hybridRetrievalMs: 8,
      hybridHydrationMs: 2,
      citationValidity: "pass",
      answerQuality: "pass",
    },
    {
      id: "semantic-paraphrase-non-regression",
      kind: "semantic_paraphrase",
      expectedChunkIds: ["chunk-c"],
      lexicalChunkIds: ["chunk-c"],
      hybridChunkIds: ["chunk-c"],
      qdrantCandidateCount: 1,
      canonicalHybridCount: 1,
      lexicalMs: 6,
      hybridRetrievalMs: 10,
      hybridHydrationMs: 2,
      citationValidity: "pass",
      answerQuality: "pass",
    },
  ])

  assert.equal(evaluation.totalCases, 3)
  assert.equal(evaluation.overall.lexical.hitRate, 2 / 3)
  assert.equal(evaluation.overall.hybrid.hitRate, 1)
  assert.equal(evaluation.overall.lexical.recall, 2 / 3)
  assert.equal(evaluation.overall.hybrid.recall, 1)
  assert.deepEqual(evaluation.byKind.lexical_anchor, {
    cases: 1,
    lexicalRecall: 1,
    hybridRecall: 1,
    nonRegressive: true,
  })
  assert.deepEqual(evaluation.byKind.semantic_paraphrase, {
    cases: 2,
    lexicalRecall: 0.5,
    hybridRecall: 1,
    nonRegressive: true,
  })
  assert.equal(evaluation.canonicalResolutionRate, 1)
  assert.equal(evaluation.citationValidity.scored, 3)
  assert.equal(evaluation.citationValidity.passRate, 1)
  assert.equal(evaluation.answerQuality.scored, 3)
  assert.equal(evaluation.answerQuality.passRate, 1)
  assert.deepEqual(evaluation.latencyMs, {
    lexicalAverage: 5,
    hybridRetrievalAverage: 9,
    hybridHydrationAverage: 7 / 3,
    hybridTotalAverage: 34 / 3,
  })
})

test("QEO-116 offline evaluation rejects unlabeled or duplicate benchmark cases instead of fabricating recall", () => {
  assert.throws(() => evaluateResearchReportQaRetrieval([{
    id: "missing-ground-truth",
    kind: "semantic_paraphrase",
    expectedChunkIds: [],
    lexicalChunkIds: [],
    hybridChunkIds: [],
    qdrantCandidateCount: 0,
    canonicalHybridCount: 0,
    lexicalMs: 0,
    hybridRetrievalMs: 0,
    hybridHydrationMs: 0,
    citationValidity: "not_scored",
    answerQuality: "not_scored",
  }]), /expectedChunkIds/i)

  const duplicate = {
    id: "duplicate-case",
    kind: "lexical_anchor" as const,
    expectedChunkIds: ["chunk-a"],
    lexicalChunkIds: ["chunk-a"],
    hybridChunkIds: ["chunk-a"],
    qdrantCandidateCount: 1,
    canonicalHybridCount: 1,
    lexicalMs: 1,
    hybridRetrievalMs: 1,
    hybridHydrationMs: 1,
    citationValidity: "not_scored" as const,
    answerQuality: "not_scored" as const,
  }
  assert.throws(() => evaluateResearchReportQaRetrieval([duplicate, duplicate]), /duplicate/i)
})
