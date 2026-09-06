import test from "node:test"
import assert from "node:assert/strict"

import {
  answerTickerQaWithOpenAi,
  getTickerQaModelRoute,
} from "../../modules/ticker-qa/openai.ts"
import { TICKER_QA_JSON_SCHEMA } from "../../modules/ticker-qa/schema.ts"
import type { TickerQaResolvedEvidence } from "../../modules/ticker-qa/canonical.ts"
import {
  createTickerKnowledgeItem,
  TICKER_KNOWLEDGE_PROJECTION_VERSION,
} from "../../modules/ticker-knowledge/domain.ts"

const item = createTickerKnowledgeItem({
  ticker: "MSN",
  knowledgeType: "BROKER_VIEW",
  authority: "SOURCE_OPINION",
  sourceType: "RESEARCH_REPORT",
  logicalKey: "ticker-qa-openai-test",
  text: "HSBC source opinion sets target price 110000 VND for MSN.",
  provenance: {
    sourceId: "report-1",
    sourceVersion: "report-v1",
    reportId: "report-1",
    analysisId: "analysis-1",
    contentHash: "e".repeat(64),
    chunkVersion: "chunk-v1",
    publishedAt: "2026-09-05",
    asOf: "2026-09-05",
  },
  projectionVersion: TICKER_KNOWLEDGE_PROJECTION_VERSION,
})

const evidence: TickerQaResolvedEvidence[] = [{
  evidenceId: `tk:${item.id}`,
  item,
  text: item.text,
  citation: {
    id: `tk:${item.id}`,
    sourceType: "RESEARCH_REPORT",
    authority: "SOURCE_OPINION",
    label: "Research Report",
    excerpt: item.text,
    href: "/research/reports/report-1",
    reportId: "report-1",
    sourceVersion: "report-v1",
  },
}]

const input = {
  ticker: "MSN",
  question: "HSBC target bao nhiêu?",
  history: [{ role: "user" as const, content: "Broker đánh giá MSN thế nào?" }],
  evidence,
}

function validOutput() {
  return {
    status: "answered",
    claims: [{
      text: "HSBC đặt mục tiêu 110.000 đồng theo quan điểm của nguồn báo cáo.",
      authority: "SOURCE_OPINION",
      citations: [{ evidenceId: evidence[0].evidenceId, excerpt: "target price 110000 VND" }],
    }],
    contradictions: [],
  }
}

function completedResponse(output: unknown = validOutput(), model = "gpt-5.6-luna") {
  return new Response(JSON.stringify({
    id: "resp_ticker_qa_1",
    model,
    status: "completed",
    output_text: JSON.stringify(output),
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 30 },
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 12 },
      total_tokens: 170,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })
}

async function withEnv<T>(callback: () => Promise<T>) {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.TICKER_QA_MODEL,
    fallback: process.env.TICKER_QA_FALLBACK_MODEL,
    effort: process.env.TICKER_QA_REASONING_EFFORT,
  }
  process.env.OPENAI_API_KEY = "test-ticker-qa-key"
  delete process.env.TICKER_QA_MODEL
  delete process.env.TICKER_QA_FALLBACK_MODEL
  delete process.env.TICKER_QA_REASONING_EFFORT
  try {
    return await callback()
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["TICKER_QA_MODEL", previous.model],
      ["TICKER_QA_FALLBACK_MODEL", previous.fallback],
      ["TICKER_QA_REASONING_EFFORT", previous.effort],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test("QEO-118 ticker QA model route defaults to Luna medium with Terra fallback", async () => {
  await withEnv(async () => {
    assert.deepEqual(getTickerQaModelRoute(), {
      model: "gpt-5.6-luna",
      fallbackModel: "gpt-5.6-terra",
      reasoningEffort: "medium",
      modelRouteKey: "ticker-qa-v1:gpt-5.6-luna:gpt-5.6-terra:medium",
    })
  })
})

test("QEO-118 ticker QA uses strict Responses API schema without storing provider data", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return completedResponse()
    }) as typeof fetch

    const result = await answerTickerQaWithOpenAi(input, { fetchImpl })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "https://api.openai.com/v1/responses")
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    assert.equal(body.model, "gpt-5.6-luna")
    assert.deepEqual(body.reasoning, { effort: "medium" })
    assert.equal(body.store, false)
    assert.deepEqual(body.tools, [])
    const format = (body.text as { format: { name: string; strict: boolean; schema: unknown } }).format
    assert.equal(format.name, "ticker_qa")
    assert.equal(format.strict, true)
    assert.deepEqual(format.schema, TICKER_QA_JSON_SCHEMA)
    assert.match(String(body.prompt_cache_key), /^ticker-qa:ticker-qa-prompt-v2-notion-free:/)
    assert.doesNotMatch(JSON.stringify(body), /test-ticker-qa-key/)
    assert.equal(result.output.status, "answered")
    assert.equal(result.audit.inputTokens, 120)
    assert.equal(result.audit.cachedInputTokens, 30)
    assert.equal(result.audit.totalTokens, 170)
  })
})

test("QEO-118 ticker QA gets one same-model repair for invalid citation output", async () => {
  await withEnv(async () => {
    const bodies: Array<Record<string, unknown>> = []
    let calls = 0
    const invalid = {
      status: "answered",
      claims: [{
        text: "forged",
        authority: "SOURCE_OPINION",
        citations: [{ evidenceId: "tk:forged", excerpt: "110000" }],
      }],
      contradictions: [],
    }
    const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      calls += 1
      return calls === 1 ? completedResponse(invalid) : completedResponse(validOutput())
    }) as typeof fetch

    const result = await answerTickerQaWithOpenAi(input, { fetchImpl })
    assert.equal(calls, 2)
    assert.equal(bodies[0].input, bodies[1].input)
    assert.match(String(bodies[1].instructions), /previous structured result failed/i)
    assert.equal(result.output.status, "answered")
  })
})
