import test from "node:test"
import assert from "node:assert/strict"

import { answerTickerQuestion, TickerQaError } from "../../modules/ticker-qa/service.ts"
import type { TickerQaResolvedEvidence } from "../../modules/ticker-qa/canonical.ts"
import {
  createTickerKnowledgeItem,
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
  type TickerKnowledgeItem,
} from "../../modules/ticker-knowledge/domain.ts"

const fakeClient = {} as never
const SECRET_QUESTION = "RAW_QUESTION_MUST_NOT_BE_LOGGED"
const SECRET_HISTORY = "RAW_HISTORY_MUST_NOT_BE_LOGGED"
const SECRET_EVIDENCE = "RAW_EVIDENCE_MUST_NOT_BE_LOGGED"

function mandatoryItem(): TickerKnowledgeItem {
  return createTickerKnowledgeItem({
    ticker: "MSN",
    knowledgeType: "COUNCIL_MEMORY",
    authority: "DETERMINISTIC_SIGNAL",
    sourceType: "AI_COUNCIL",
    logicalKey: "current-council",
    text: SECRET_EVIDENCE,
    provenance: {
      sourceId: "council-msn",
      sourceVersion: "f".repeat(64),
      asOf: "2026-09-05T10:00:00Z",
      publishedAt: "2026-09-05T10:00:00Z",
    },
    projectionVersion: TICKER_KNOWLEDGE_PROJECTION_VERSION,
  })
}

function resolved(item: TickerKnowledgeItem): TickerQaResolvedEvidence {
  return {
    evidenceId: `tk:${item.id}`,
    item,
    text: item.text,
    citation: {
      id: `tk:${item.id}`,
      sourceType: "AI_COUNCIL",
      authority: "DETERMINISTIC_SIGNAL",
      label: "Latest AI Council",
      excerpt: item.text,
      href: null,
      sourceVersion: item.provenance.sourceVersion,
    },
  }
}

function context(status: "ready" | "unavailable", items: readonly TickerKnowledgeItem[]) {
  return {
    ticker: "MSN",
    query: SECRET_QUESTION,
    consumer: "STOCK_QA" as const,
    retrievalStatus: status,
    retrievalReason: status === "unavailable" ? "qdrant_timeout" as const : null,
    items: [...items],
    retrievedPointIds: [],
    text: items.map((item) => item.text).join("\n"),
    truncated: false,
    telemetry: {
      totalMs: 9,
      alwaysLoadMs: 1,
      retrievalMs: 4,
      rerankMs: 2,
      buildMs: 2,
    },
  }
}

const providerAudit = {
  promptVersion: "ticker-qa-prompt-v2",
  requestedModel: "gpt-5.6-luna",
  responseModel: "gpt-5.6-luna",
  fallbackUsed: false,
  attemptedModels: ["gpt-5.6-luna"],
  responseId: "resp_test",
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 40,
  reasoningTokens: 10,
  totalTokens: 140,
  latencyMs: 11,
}

test("QEO-118 Qdrant outage still allows grounded mandatory-only answer with explicit degraded state", async () => {
  const item = mandatoryItem()
  let answerCalls = 0
  const result = await answerTickerQuestion(fakeClient, {
    ticker: "MSN",
    question: "Council hiện tại?",
  }, {
    loadMandatory: async () => ({ items: [item], limitations: [] }),
    buildContext: async () => context("unavailable", [item]),
    resolveEvidence: async () => ({
      evidence: [resolved(item)],
      unresolvedCount: 0,
      infrastructureFailure: false,
      hydrationMs: 3,
    }),
    answerWithAi: async () => {
      answerCalls += 1
      return {
        output: {
          status: "answered",
          claims: [{
            text: "Tín hiệu AI Council hiện tại vẫn là trạng thái deterministic đã lưu.",
            authority: "DETERMINISTIC_SIGNAL",
            citations: [{ evidenceId: `tk:${item.id}`, excerpt: SECRET_EVIDENCE }],
          }],
          contradictions: [],
        },
        audit: providerAudit,
        route: { model: "gpt-5.6-luna", fallbackModel: "gpt-5.6-terra", reasoningEffort: "medium", modelRouteKey: "ticker-qa-v1" },
      }
    },
  })

  assert.equal(answerCalls, 1)
  assert.equal(result.status, "answered")
  assert.equal(result.retrievalStatus, "unavailable")
  assert.equal(
    result.limitation,
    "Semantic ticker knowledge retrieval is temporarily unavailable; answer uses available canonical context.",
  )
})

test("QEO-118 unavailable retrieval plus zero canonical evidence returns service_unavailable without model call", async () => {
  let answerCalls = 0
  await assert.rejects(() => answerTickerQuestion(fakeClient, {
    ticker: "MSN",
    question: "Council hiện tại?",
  }, {
    loadMandatory: async () => ({ items: [], limitations: ["LATEST_COUNCIL unavailable"] }),
    buildContext: async () => context("unavailable", []),
    resolveEvidence: async () => ({ evidence: [], unresolvedCount: 0, infrastructureFailure: false, hydrationMs: 1 }),
    answerWithAi: async () => {
      answerCalls += 1
      throw new Error("must not be called")
    },
  }), (error: unknown) => error instanceof TickerQaError && error.code === "service_unavailable")
  assert.equal(answerCalls, 0)
})

test("QEO-118 healthy retrieval with no grounded evidence returns not_found without model call", async () => {
  let answerCalls = 0
  const result = await answerTickerQuestion(fakeClient, {
    ticker: "MSN",
    question: "Không có bằng chứng?",
  }, {
    loadMandatory: async () => ({ items: [], limitations: [] }),
    buildContext: async () => context("ready", []),
    resolveEvidence: async () => ({ evidence: [], unresolvedCount: 0, infrastructureFailure: false, hydrationMs: 1 }),
    answerWithAi: async () => {
      answerCalls += 1
      throw new Error("must not be called")
    },
  })
  assert.equal(answerCalls, 0)
  assert.equal(result.status, "not_found")
  assert.equal(result.retrievalStatus, "ready")
})

test("QEO-118 canonical infrastructure failure with no surviving evidence fails unavailable", async () => {
  await assert.rejects(() => answerTickerQuestion(fakeClient, {
    ticker: "MSN",
    question: "Council từng sai khi nào?",
  }, {
    loadMandatory: async () => ({ items: [], limitations: [] }),
    buildContext: async () => context("ready", []),
    resolveEvidence: async () => ({ evidence: [], unresolvedCount: 1, infrastructureFailure: true, hydrationMs: 2 }),
    answerWithAi: async () => { throw new Error("must not be called") },
  }), (error: unknown) => error instanceof TickerQaError && error.code === "service_unavailable")
})

test("QEO-118 telemetry is aggregate-only and excludes raw question history evidence and prompt text", async () => {
  const item = mandatoryItem()
  let metric: unknown = null
  await answerTickerQuestion(fakeClient, {
    ticker: "MSN",
    question: SECRET_QUESTION,
    history: [{ role: "user", content: SECRET_HISTORY }],
  }, {
    loadMandatory: async () => ({ items: [item], limitations: [] }),
    buildContext: async () => context("ready", [item]),
    resolveEvidence: async () => ({
      evidence: [resolved(item)],
      unresolvedCount: 0,
      infrastructureFailure: false,
      hydrationMs: 3,
    }),
    answerWithAi: async () => ({
      output: {
        status: "answered",
        claims: [{
          text: "Grounded answer",
          authority: "DETERMINISTIC_SIGNAL",
          citations: [{ evidenceId: `tk:${item.id}`, excerpt: SECRET_EVIDENCE }],
        }],
        contradictions: [],
      },
      audit: providerAudit,
      route: { model: "gpt-5.6-luna", fallbackModel: "gpt-5.6-terra", reasoningEffort: "medium", modelRouteKey: "ticker-qa-v1" },
    }),
    recordTelemetry: (value) => { metric = value },
  })

  const serialized = JSON.stringify(metric)
  assert.ok(serialized.length > 2)
  assert.doesNotMatch(serialized, new RegExp(SECRET_QUESTION))
  assert.doesNotMatch(serialized, new RegExp(SECRET_HISTORY))
  assert.doesNotMatch(serialized, new RegExp(SECRET_EVIDENCE))
  assert.doesNotMatch(serialized, /prompt/i)
  assert.match(serialized, /resolvedEvidenceCount/)
  assert.match(serialized, /totalTokens/)
})
