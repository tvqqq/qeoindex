import assert from "node:assert/strict"
import test from "node:test"

import {
  answerResearchReportQaWithOpenAi,
  getResearchReportQaModelRoute,
} from "../../modules/research-reports/qa/openai.ts"
import { RESEARCH_REPORT_QA_JSON_SCHEMA } from "../../modules/research-reports/qa/schema.ts"
import type { ResearchReportQaEvidence } from "../../modules/research-reports/qa/types.ts"

const evidence: ResearchReportQaEvidence[] = [{
  evidenceId: "rr:aaaaaaaaaaaa:report-chunk-v1:44444444-4444-4444-8444-444444444444",
  chunkId: "44444444-4444-4444-8444-444444444444",
  reportId: "11111111-1111-4111-8111-111111111111",
  contentHash: "a".repeat(64),
  chunkVersion: "report-chunk-v1",
  page: 7,
  chunkIndex: 1,
  content: "HSBC nâng giá mục tiêu MSN lên 110.000 đồng/cp và duy trì khuyến nghị Mua.",
  rank: 0.5,
}]

const input = {
  question: "MSN target price là bao nhiêu?",
  history: [{ role: "user" as const, content: "HSBC đánh giá MSN thế nào?" }],
  evidence,
}

function validOutput() {
  return {
    status: "answered",
    claims: [{
      text: "Báo cáo nêu giá mục tiêu MSN là 110.000 đồng/cp.",
      citations: [{
        evidenceId: evidence[0].evidenceId,
        excerpt: "giá mục tiêu MSN lên 110.000 đồng/cp",
      }],
    }],
  }
}

function completedResponse(
  output: unknown = validOutput(),
  options: {
    id?: string
    model?: string
    inputTokens?: number
    cachedTokens?: number
    outputTokens?: number
    reasoningTokens?: number
  } = {},
) {
  const inputTokens = options.inputTokens ?? 100
  const outputTokens = options.outputTokens ?? 40
  return new Response(JSON.stringify({
    id: options.id ?? "resp_qa_1",
    model: options.model ?? "gpt-5.6-luna",
    status: "completed",
    output_text: JSON.stringify(output),
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: options.cachedTokens ?? 20 },
      output_tokens: outputTokens,
      output_tokens_details: { reasoning_tokens: options.reasoningTokens ?? 10 },
      total_tokens: inputTokens + outputTokens,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })
}

function incompleteResponse() {
  return new Response(JSON.stringify({
    id: "resp_qa_incomplete",
    model: "gpt-5.6-luna",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 80,
      input_tokens_details: { cached_tokens: 8 },
      output_tokens: 1600,
      output_tokens_details: { reasoning_tokens: 200 },
      total_tokens: 1680,
    },
  }), { status: 200, headers: { "content-type": "application/json" } })
}

async function withEnv<T>(callback: () => Promise<T>) {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.RESEARCH_REPORT_QA_MODEL,
    fallback: process.env.RESEARCH_REPORT_QA_FALLBACK_MODEL,
    effort: process.env.RESEARCH_REPORT_QA_REASONING_EFFORT,
  }
  process.env.OPENAI_API_KEY = "test-qa-key"
  delete process.env.RESEARCH_REPORT_QA_MODEL
  delete process.env.RESEARCH_REPORT_QA_FALLBACK_MODEL
  delete process.env.RESEARCH_REPORT_QA_REASONING_EFFORT
  try {
    return await callback()
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["RESEARCH_REPORT_QA_MODEL", previous.model],
      ["RESEARCH_REPORT_QA_FALLBACK_MODEL", previous.fallback],
      ["RESEARCH_REPORT_QA_REASONING_EFFORT", previous.effort],
    ] as const) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test("QEO-82 QA route defaults to Luna medium with Terra fallback and supports env overrides", async () => {
  await withEnv(async () => {
    assert.deepEqual(getResearchReportQaModelRoute(), {
      model: "gpt-5.6-luna",
      fallbackModel: "gpt-5.6-terra",
      reasoningEffort: "medium",
      modelRouteKey: "report-qa-v1:gpt-5.6-luna:gpt-5.6-terra:medium",
    })

    process.env.RESEARCH_REPORT_QA_MODEL = "gpt-5.6-sol"
    process.env.RESEARCH_REPORT_QA_FALLBACK_MODEL = "gpt-5-mini"
    process.env.RESEARCH_REPORT_QA_REASONING_EFFORT = "high"
    assert.deepEqual(getResearchReportQaModelRoute(), {
      model: "gpt-5.6-sol",
      fallbackModel: "gpt-5-mini",
      reasoningEffort: "high",
      modelRouteKey: "report-qa-v1:gpt-5.6-sol:gpt-5-mini:high",
    })
  })
})

test("QEO-82 QA uses strict Responses API request and returns compatible usage audit", async () => {
  await withEnv(async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchImpl = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return completedResponse()
    }) as typeof fetch

    const result = await answerResearchReportQaWithOpenAi(input, { fetchImpl })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, "https://api.openai.com/v1/responses")
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    assert.equal(body.model, "gpt-5.6-luna")
    assert.deepEqual(body.reasoning, { effort: "medium" })
    assert.equal(body.store, false)
    assert.deepEqual(body.tools, [])
    assert.equal(body.max_output_tokens, 1600)
    const text = body.text as { format: { type: string; name: string; strict: boolean; schema: unknown } }
    assert.equal(text.format.type, "json_schema")
    assert.equal(text.format.name, "research_report_qa")
    assert.equal(text.format.strict, true)
    assert.deepEqual(text.format.schema, RESEARCH_REPORT_QA_JSON_SCHEMA)
    assert.match(String(body.prompt_cache_key), /^research-report-qa:report-qa-prompt-v1:/)
    assert.doesNotMatch(JSON.stringify(body), /test-qa-key/)

    assert.equal(result.output.status, "answered")
    assert.equal(result.audit.promptVersion, "report-qa-prompt-v1")
    assert.equal(result.audit.requestedModel, "gpt-5.6-luna")
    assert.equal(result.audit.responseModel, "gpt-5.6-luna")
    assert.equal(result.audit.fallbackUsed, false)
    assert.deepEqual(result.audit.attemptedModels, ["gpt-5.6-luna"])
    assert.equal(result.audit.responseId, "resp_qa_1")
    assert.equal(result.audit.inputTokens, 100)
    assert.equal(result.audit.cachedInputTokens, 20)
    assert.equal(result.audit.outputTokens, 40)
    assert.equal(result.audit.reasoningTokens, 10)
    assert.equal(result.audit.totalTokens, 140)
    assert.equal(result.audit.estimatedCostUsd, null)
    assert.equal(result.audit.pricingVersion, null)
  })
})

test("QEO-82 QA retries incomplete max-output exactly once with bounded larger budget", async () => {
  await withEnv(async () => {
    const bodies: Array<Record<string, unknown>> = []
    let calls = 0
    const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      calls += 1
      return calls === 1 ? incompleteResponse() : completedResponse()
    }) as typeof fetch

    const result = await answerResearchReportQaWithOpenAi(input, { fetchImpl })
    assert.equal(calls, 2)
    assert.equal(bodies[0].max_output_tokens, 1600)
    assert.equal(bodies[1].max_output_tokens, 2400)
    assert.equal(bodies[0].model, "gpt-5.6-luna")
    assert.equal(bodies[1].model, "gpt-5.6-luna")
    assert.equal(result.audit.inputTokens, 180)
    assert.equal(result.audit.outputTokens, 1640)
    assert.equal(result.audit.totalTokens, 1820)
  })
})

test("QEO-82 QA falls back only on retryable provider failure and fails fast on auth", async () => {
  await withEnv(async () => {
    const models: string[] = []
    let calls = 0
    const fallbackFetch = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      models.push(body.model)
      calls += 1
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 })
      }
      return completedResponse(validOutput(), { model: "gpt-5.6-terra", id: "resp_qa_fallback" })
    }) as typeof fetch

    const result = await answerResearchReportQaWithOpenAi(input, { fetchImpl: fallbackFetch })
    assert.deepEqual(models, ["gpt-5.6-luna", "gpt-5.6-terra"])
    assert.equal(result.audit.fallbackUsed, true)
    assert.equal(result.audit.responseModel, "gpt-5.6-terra")

    let authCalls = 0
    const authFetch = (async () => {
      authCalls += 1
      return new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })
    }) as typeof fetch
    await assert.rejects(() => answerResearchReportQaWithOpenAi(input, { fetchImpl: authFetch }), /401|invalid key|OpenAI/i)
    assert.equal(authCalls, 1)
  })
})

test("QEO-82 QA gets one same-model immutable-evidence repair after citation validation failure", async () => {
  await withEnv(async () => {
    const bodies: Array<Record<string, unknown>> = []
    let calls = 0
    const invalid = {
      status: "answered",
      claims: [{ text: "Forged", citations: [{ evidenceId: "forged", excerpt: "110.000" }] }],
    }
    const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      calls += 1
      return calls === 1 ? completedResponse(invalid) : completedResponse(validOutput(), { id: "resp_qa_repaired" })
    }) as typeof fetch

    const result = await answerResearchReportQaWithOpenAi(input, { fetchImpl })
    assert.equal(calls, 2)
    assert.equal(bodies[0].model, "gpt-5.6-luna")
    assert.equal(bodies[1].model, "gpt-5.6-luna")
    assert.equal(bodies[0].input, bodies[1].input)
    assert.notEqual(bodies[0].instructions, bodies[1].instructions)
    assert.match(String(bodies[1].instructions), /previous structured result failed/i)
    assert.deepEqual(result.audit.attemptedModels, ["gpt-5.6-luna"])
    assert.equal(result.audit.fallbackUsed, false)
  })
})

test("QEO-82 QA second invalid repair fails closed without fallback", async () => {
  await withEnv(async () => {
    let calls = 0
    const invalid = {
      status: "answered",
      claims: [{ text: "Forged", citations: [{ evidenceId: "forged", excerpt: "110.000" }] }],
    }
    const fetchImpl = (async () => {
      calls += 1
      return completedResponse(invalid)
    }) as typeof fetch

    await assert.rejects(() => answerResearchReportQaWithOpenAi(input, { fetchImpl }), /validation|evidence|ground/i)
    assert.equal(calls, 2)
  })
})
