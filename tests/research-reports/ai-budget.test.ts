import assert from "node:assert/strict"
import test from "node:test"

import {
  ResearchReportBudgetExceededError,
  createResearchReportAiBudget,
} from "../../modules/research-reports/analysis/budget.ts"
import { analyzeResearchReportPages } from "../../modules/research-reports/analysis/openai.ts"
import type { ParsedReportPage } from "../../modules/research-reports/types.ts"

const pages: ParsedReportPage[] = [{
  pageNumber: 1,
  text: "MSN outlook is positive. Target price is 85,000 VND.",
}]

function validAnalysis() {
  return {
    executiveSummary: "Positive MSN outlook.",
    keyPoints: ["Positive outlook"],
    marketView: null,
    sectorOutlook: null,
    catalysts: [],
    risks: [],
    tickerMentions: [{
      ticker: "MSN",
      stance: "positive",
      recommendationText: null,
      targetPrice: 85000,
      targetCurrency: "VND",
      rationale: "The report states a positive outlook.",
      evidence: [{ page: 1, snippet: "MSN outlook is positive." }],
    }],
    confidence: { score: 90, flags: [] },
  }
}

function completedResponse(model = "gpt-5.6-luna") {
  return new Response(JSON.stringify({
    id: "resp_budget",
    model,
    status: "completed",
    output_text: JSON.stringify(validAnalysis()),
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 8 },
      total_tokens: 140,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })
}

async function withOpenAiKey<T>(callback: () => Promise<T>) {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = "test-openai-key"
  try {
    return await callback()
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
}

test("QEO-85 consumes the request-attempt budget before dispatch", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 2,
    maxEstimatedCostUsd: 1,
  })

  budget.beforeRequest({ reservedCostUsd: 0.1 })
  budget.beforeRequest({ reservedCostUsd: 0.1 })

  assert.deepEqual(budget.snapshot(), {
    requestAttempts: 2,
    maxRequestAttempts: 2,
    estimatedCostUsd: 0,
    maxEstimatedCostUsd: 1,
    unknownUsageAttempts: 0,
    budgetExhausted: false,
    budgetReason: null,
  })

  assert.throws(
    () => budget.beforeRequest({ reservedCostUsd: 0.1 }),
    (error: unknown) => error instanceof ResearchReportBudgetExceededError
      && error.reason === "ai_request_limit",
  )
})

test("QEO-85 blocks a request whose conservative reservation exceeds remaining USD", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 20,
    maxEstimatedCostUsd: 1,
  })

  budget.recordResponseCost(0.85)
  assert.throws(
    () => budget.beforeRequest({ reservedCostUsd: 0.16 }),
    (error: unknown) => error instanceof ResearchReportBudgetExceededError
      && error.reason === "estimated_cost_limit",
  )
  assert.equal(budget.snapshot().requestAttempts, 0)
  assert.equal(budget.snapshot().budgetExhausted, true)
})

test("QEO-85 records lost-response attempts as unknown usage without fabricating cost", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 20,
    maxEstimatedCostUsd: 1,
  })

  budget.beforeRequest({ reservedCostUsd: 0.3 })
  budget.recordUnknownUsage()

  const snapshot = budget.snapshot()
  assert.equal(snapshot.requestAttempts, 1)
  assert.equal(snapshot.unknownUsageAttempts, 1)
  assert.equal(snapshot.estimatedCostUsd, 0)
})

test("QEO-85 accumulates confirmed provider cost without counting reservations as spend", () => {
  const budget = createResearchReportAiBudget({
    maxRequestAttempts: 20,
    maxEstimatedCostUsd: 1,
  })

  budget.beforeRequest({ reservedCostUsd: 0.4 })
  budget.recordResponseCost(0.012345)
  budget.beforeRequest({ reservedCostUsd: 0.4 })
  budget.recordResponseCost(0.02)

  assert.equal(budget.snapshot().estimatedCostUsd, 0.032345)
  assert.equal(budget.snapshot().requestAttempts, 2)
})

test("QEO-85 blocks fallback before provider dispatch when request-attempt budget is exhausted", async () => {
  await withOpenAiKey(async () => {
    const budget = createResearchReportAiBudget({ maxRequestAttempts: 1, maxEstimatedCostUsd: 1 })
    let fetchCalls = 0
    const fetchImpl = (async () => {
      fetchCalls += 1
      if (fetchCalls === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
          headers: { "content-type": "application/json" },
        })
      }
      return completedResponse("gpt-5.6-terra")
    }) as typeof fetch

    await assert.rejects(
      () => analyzeResearchReportPages(pages, { fetchImpl, budget }),
      ResearchReportBudgetExceededError,
    )
    assert.equal(fetchCalls, 1)
    assert.equal(budget.snapshot().requestAttempts, 1)
  })
})

test("QEO-85 transport failures consume one attempt and record unknown usage before fallback", async () => {
  await withOpenAiKey(async () => {
    const budget = createResearchReportAiBudget({ maxRequestAttempts: 1, maxEstimatedCostUsd: 1 })
    let fetchCalls = 0
    const fetchImpl = (async () => {
      fetchCalls += 1
      throw new Error("socket reset")
    }) as typeof fetch

    await assert.rejects(() => analyzeResearchReportPages(pages, { fetchImpl, budget }))
    assert.equal(fetchCalls, 1)
    assert.equal(budget.snapshot().requestAttempts, 1)
    assert.equal(budget.snapshot().unknownUsageAttempts, 1)
    assert.equal(budget.snapshot().estimatedCostUsd, 0)
  })
})

test("QEO-85 successful analysis exposes cache-write tokens and versioned estimated USD", async () => {
  await withOpenAiKey(async () => {
    const budget = createResearchReportAiBudget()
    const result = await analyzeResearchReportPages(pages, {
      budget,
      fetchImpl: (async () => completedResponse()) as typeof fetch,
    })

    assert.equal(result.audit.cacheWriteTokens, 10)
    assert.equal(result.audit.estimatedCostUsd, 0.000064)
    assert.equal(result.audit.pricingVersion, "openai-gpt-5.6-standard-2026-09-05")
    assert.equal(budget.snapshot().estimatedCostUsd, 0.000064)
    assert.equal(budget.snapshot().requestAttempts, 1)
  })
})
