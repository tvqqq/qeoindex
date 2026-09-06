import test from "node:test"
import assert from "node:assert/strict"

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
