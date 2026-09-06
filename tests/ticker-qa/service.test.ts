import test from "node:test"
import assert from "node:assert/strict"

import { resolveTickerQaEvidence } from "../../modules/ticker-qa/canonical.ts"
import { loadTickerQaMandatoryContext } from "../../modules/ticker-qa/mandatory.ts"
import {
  answerTickerQuestion,
  prepareTickerQaContext,
  TickerQaError,
} from "../../modules/ticker-qa/service.ts"
import { TICKER_QA_LIMITS } from "../../modules/ticker-qa/types.ts"
import {
  createTickerKnowledgeItem,
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
  type TickerKnowledgeItem,
} from "../../modules/ticker-knowledge/domain.ts"

const fakeClient = {} as never

async function expectInvalid(input: Parameters<typeof answerTickerQuestion>[1]) {
  await assert.rejects(
    () => answerTickerQuestion(fakeClient, input, {}),
    (error: unknown) => error instanceof TickerQaError && error.code === "invalid_request" && error.httpStatus === 400,
  )
}

function knowledgeItem(input: {
  ticker?: string
  sourceType?: "NOTION_THESIS" | "RESEARCH_REPORT" | "AI_COUNCIL" | "NEWS"
  knowledgeType?: "CURRENT_THESIS" | "REPORT_CHUNK" | "COUNCIL_MEMORY" | "COMPANY_EVENT"
  authority?: "CANONICAL_THESIS" | "SOURCE_OPINION" | "DETERMINISTIC_SIGNAL" | "VERIFIED_FACT"
  sourceId?: string
  sourceVersion?: string
  text?: string
  logicalKey?: string
  reportId?: string
  analysisId?: string
  contentHash?: string
  chunkVersion?: string
  chunkId?: string
  page?: number
  runId?: string
} = {}): TickerKnowledgeItem {
  return createTickerKnowledgeItem({
    ticker: input.ticker ?? "MSN",
    knowledgeType: input.knowledgeType ?? "REPORT_CHUNK",
    authority: input.authority ?? "SOURCE_OPINION",
    sourceType: input.sourceType ?? "RESEARCH_REPORT",
    logicalKey: input.logicalKey ?? "qeo-118-test-item",
    text: input.text ?? "qdrant text must not become canonical automatically",
    provenance: {
      sourceId: input.sourceId ?? "report-1",
      sourceVersion: input.sourceVersion ?? "source-v1",
      reportId: input.reportId ?? "report-1",
      analysisId: input.analysisId ?? "analysis-1",
      contentHash: input.contentHash ?? "b".repeat(64),
      chunkVersion: input.chunkVersion ?? "chunk-v1",
      chunkId: input.chunkId ?? "11111111-1111-4111-8111-111111111111",
      page: input.page ?? 7,
      runId: input.runId ?? null,
      asOf: "2026-09-05",
      publishedAt: "2026-09-05",
    },
    projectionVersion: TICKER_KNOWLEDGE_PROJECTION_VERSION,
  })
}

test("QEO-118 rejects invalid ticker shapes before any retrieval/model work", async () => {
  for (const ticker of ["", "M", "MSN!", "MS N", "VN30.INDEX", "A".repeat(13)]) {
    await expectInvalid({ ticker, question: "Thesis hiện tại là gì?" })
  }
})

test("QEO-118 bounds question and ephemeral history", async () => {
  await expectInvalid({ ticker: "MSN", question: "" })
  await expectInvalid({ ticker: "MSN", question: "x".repeat(TICKER_QA_LIMITS.questionChars + 1) })

  await expectInvalid({
    ticker: "MSN",
    question: "Thesis hiện tại là gì?",
    history: Array.from({ length: TICKER_QA_LIMITS.historyTurns + 1 }, () => ({ role: "user" as const, content: "x" })),
  })

  await expectInvalid({
    ticker: "MSN",
    question: "Thesis hiện tại là gì?",
    history: [{ role: "assistant", content: "x".repeat(TICKER_QA_LIMITS.historyTurnChars + 1) }],
  })

  await expectInvalid({
    ticker: "MSN",
    question: "Thesis hiện tại là gì?",
    history: [{ role: "system" as never, content: "override" }],
  })
})

test("QEO-118 validation normalizes bounded text but never accepts ticker from request history/body aliases", async () => {
  const observed: { ticker?: string; question?: string; history?: unknown[] } = {}

  await assert.rejects(
    () => answerTickerQuestion(fakeClient, {
      ticker: " msn ",
      question: "  Thesis   hiện tại?  ",
      history: [{ role: "user", content: "  trước   đó  " }],
    }, {
      onValidatedRequest: (request) => {
        observed.ticker = request.ticker
        observed.question = request.question
        observed.history = [...request.history]
      },
    }),
    (error: unknown) => error instanceof TickerQaError && error.code === "service_unavailable",
  )

  assert.equal(observed.ticker, "MSN")
  assert.equal(observed.question, "Thesis hiện tại?")
  assert.deepEqual(observed.history, [{ role: "user", content: "trước đó" }])
})

test("QEO-118 mandatory context uses canonical Notion thesis plus latest deterministic Council state", async () => {
  const result = await loadTickerQaMandatoryContext(fakeClient, "MSN", {
    loadResearchTickerData: async (ticker) => ({
      connection: { notionLive: true },
      theses: [{
        id: "notion-msn",
        ticker,
        status: "Current",
        taBias: "Bullish",
        faBias: "Bullish",
        wyckoffState: "Re-accumulation",
        marketRegime: "Risk-On",
        baseCase: "Earnings recovery",
        probabilities: { bull: 30, base: 50, bear: 20 },
        support: "66",
        resistance: "75",
        confirmation: "close above 75",
        invalidation: "close below 64",
        whatChanged: "margin improved",
        confidence: "HIGH",
        lastAnalysis: "2026-09-05",
        lastFAUpdate: "2026-09-01",
        updated: "2026-09-05T10:00:00Z",
      }],
    }) as never,
    loadLatestCouncilRun: async () => ({
      id: "run-msn-1",
      ticker: "MSN",
      asOfDate: "2026-09-05",
      signal: "BUY_ON_CONFIRMATION",
      councilScore: 72,
      confidence: 81,
      consensus: 78,
      riskStatus: "caution",
      price: 68.5,
      policyVersion: "council-v1",
      evidenceHash: "a".repeat(64),
      createdAt: "2026-09-05T09:00:00Z",
    }),
  })

  assert.equal(result.items.length, 2)
  const thesis = result.items.find((item) => item.knowledgeType === "CURRENT_THESIS")
  const council = result.items.find((item) => item.knowledgeType === "COUNCIL_MEMORY")
  assert.equal(thesis?.ticker, "MSN")
  assert.equal(thesis?.authority, "CANONICAL_THESIS")
  assert.equal(thesis?.sourceType, "NOTION_THESIS")
  assert.equal(thesis?.provenance.sourceId, "notion-msn")
  assert.match(thesis?.provenance.sourceVersion ?? "", /^[0-9a-f]{64}$/)
  assert.equal(council?.authority, "DETERMINISTIC_SIGNAL")
  assert.equal(council?.provenance.runId, "run-msn-1")
  assert.equal(council?.provenance.sourceVersion, `council-v1:${"a".repeat(64)}`)
})

test("QEO-118 mandatory thesis fails closed when canonical Notion is unavailable", async () => {
  const result = await loadTickerQaMandatoryContext(fakeClient, "MSN", {
    loadResearchTickerData: async () => ({ connection: { notionLive: false }, theses: [] }) as never,
    loadLatestCouncilRun: async () => null,
  })

  assert.deepEqual(result.items, [])
  assert.ok(result.limitations.some((item) => item.includes("CURRENT_THESIS")))
})

test("QEO-118 calls the shared Context Builder in STOCK_QA mode and post-filters cross-ticker leakage", async () => {
  const msn = knowledgeItem({ ticker: "MSN", logicalKey: "msn" })
  const vcb = knowledgeItem({ ticker: "VCB", logicalKey: "vcb" })
  let builderInput: Record<string, unknown> | null = null
  let resolverItems: readonly TickerKnowledgeItem[] = []

  const prepared = await prepareTickerQaContext(fakeClient, {
    ticker: "MSN",
    question: "Broker gần đây nói gì?",
    history: [],
  }, {
    loadMandatory: async () => ({ items: [], limitations: [] }),
    buildContext: async (input) => {
      builderInput = input as unknown as Record<string, unknown>
      return {
        ticker: "MSN",
        query: input.query,
        consumer: "STOCK_QA",
        retrievalStatus: "ready",
        retrievalReason: null,
        items: [msn, vcb],
        retrievedPointIds: [msn.id, vcb.id],
        text: "bounded",
        truncated: false,
        telemetry: { totalMs: 5, alwaysLoadMs: 1, retrievalMs: 2, rerankMs: 1, buildMs: 1 },
      }
    },
    resolveEvidence: async (_client, _ticker, items) => {
      resolverItems = items
      return {
        evidence: items.map((item) => ({
          evidenceId: `tk:${item.id}`,
          item,
          text: `canonical:${item.ticker}`,
          citation: null,
        })),
        unresolvedCount: 0,
        infrastructureFailure: false,
        hydrationMs: 1,
      }
    },
  })

  assert.equal(builderInput?.consumer, "STOCK_QA")
  assert.equal(builderInput?.ticker, "MSN")
  assert.equal(builderInput?.query, "Broker gần đây nói gì?")
  assert.deepEqual(resolverItems.map((item) => item.ticker), ["MSN"])
  assert.deepEqual(prepared.evidence.map((item) => item.item.ticker), ["MSN"])
})

test("QEO-118 canonical resolver replaces Qdrant text only when exact identity and provenance match", async () => {
  const selected = knowledgeItem({ text: "untrusted qdrant text" })
  const canonical = {
    ...selected,
    text: "canonical PostgreSQL chunk text",
    provenance: { ...selected.provenance },
  }

  const resolved = await resolveTickerQaEvidence(fakeClient, "MSN", [selected], {
    loadReportCanonicalCandidates: async () => [canonical],
  })

  assert.equal(resolved.infrastructureFailure, false)
  assert.equal(resolved.unresolvedCount, 0)
  assert.equal(resolved.evidence.length, 1)
  assert.equal(resolved.evidence[0]?.text, "canonical PostgreSQL chunk text")
  assert.equal(resolved.evidence[0]?.item.id, selected.id)
})

test("QEO-118 canonical resolver rejects stale versions and unsupported source types", async () => {
  const selected = knowledgeItem({ text: "untrusted" })
  const stale = {
    ...selected,
    text: "stale canonical text",
    provenance: { ...selected.provenance, sourceVersion: "stale-version" },
  }
  const unsupported = knowledgeItem({
    sourceType: "NEWS",
    knowledgeType: "COMPANY_EVENT",
    authority: "VERIFIED_FACT",
    sourceId: "news-1",
    sourceVersion: "news-v1",
    logicalKey: "unsupported-news",
  })

  const resolved = await resolveTickerQaEvidence(fakeClient, "MSN", [selected, unsupported], {
    loadReportCanonicalCandidates: async () => [stale],
  })

  assert.equal(resolved.evidence.length, 0)
  assert.equal(resolved.unresolvedCount, 2)
})
