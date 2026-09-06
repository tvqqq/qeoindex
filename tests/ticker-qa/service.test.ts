import test from "node:test"
import assert from "node:assert/strict"

import { loadTickerQaMandatoryContext } from "../../modules/ticker-qa/mandatory.ts"
import { answerTickerQuestion, TickerQaError } from "../../modules/ticker-qa/service.ts"
import { TICKER_QA_LIMITS } from "../../modules/ticker-qa/types.ts"

const fakeClient = {} as never

async function expectInvalid(input: Parameters<typeof answerTickerQuestion>[1]) {
  await assert.rejects(
    () => answerTickerQuestion(fakeClient, input, {}),
    (error: unknown) => error instanceof TickerQaError && error.code === "invalid_request" && error.httpStatus === 400,
  )
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
