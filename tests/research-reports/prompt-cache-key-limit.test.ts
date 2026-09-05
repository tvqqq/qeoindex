import assert from "node:assert/strict"
import test from "node:test"

import { buildAiCouncilPromptCacheKey } from "../../modules/ai-council/prompt-identity.ts"
import { analyzeResearchReportPages } from "../../modules/research-reports/analysis/openai.ts"
import { answerResearchReportQaWithOpenAi } from "../../modules/research-reports/qa/openai.ts"
import type { ResearchReportQaEvidence } from "../../modules/research-reports/qa/types.ts"

const MAX_PROMPT_CACHE_KEY_LENGTH = 64

async function captureRejectedRequest(
  invoke: (fetchImpl: typeof fetch) => Promise<unknown>,
) {
  let body: Record<string, unknown> | null = null
  const fetchImpl = (async (_url: URL | RequestInfo, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response(JSON.stringify({ error: { message: "stop after request capture" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  await assert.rejects(() => invoke(fetchImpl), /401|stop after request capture|OpenAI/i)
  assert.ok(body)
  return body
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

test("QEO-87 report analysis prompt cache key stays within OpenAI 64-char contract", async () => {
  await withOpenAiKey(async () => {
    const body = await captureRejectedRequest((fetchImpl) => analyzeResearchReportPages([
      { pageNumber: 1, text: "Material report evidence ".repeat(8) },
    ], { fetchImpl }))
    const key = String(body.prompt_cache_key)
    assert.match(key, /^research-report:report-analysis-prompt-v1:/)
    assert.ok(key.length <= MAX_PROMPT_CACHE_KEY_LENGTH)
  })
})

test("QEO-87 report Q&A prompt cache key stays within OpenAI 64-char contract", async () => {
  await withOpenAiKey(async () => {
    const evidence: ResearchReportQaEvidence[] = [{
      evidenceId: "rr:aaaaaaaaaaaa:report-chunk-v1:44444444-4444-4444-8444-444444444444",
      chunkId: "44444444-4444-4444-8444-444444444444",
      reportId: "11111111-1111-4111-8111-111111111111",
      contentHash: "a".repeat(64),
      chunkVersion: "report-chunk-v1",
      page: 1,
      chunkIndex: 0,
      content: "The report states an explicit target price.",
      rank: 1,
    }]
    const body = await captureRejectedRequest((fetchImpl) => answerResearchReportQaWithOpenAi({
      question: "What is the target price?",
      history: [],
      evidence,
    }, { fetchImpl }))
    const key = String(body.prompt_cache_key)
    assert.match(key, /^research-report-qa:report-qa-prompt-v1:/)
    assert.ok(key.length <= MAX_PROMPT_CACHE_KEY_LENGTH)
  })
})

test("QEO-87 AI Council prompt cache key remains within the same provider limit", () => {
  const key = buildAiCouncilPromptCacheKey("a".repeat(64))
  assert.match(key, /^qeo-council-/)
  assert.ok(key.length <= MAX_PROMPT_CACHE_KEY_LENGTH)
})
