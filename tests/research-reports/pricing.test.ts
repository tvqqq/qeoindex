import assert from "node:assert/strict"
import test from "node:test"

import {
  RESEARCH_REPORT_PRICING_VERSION,
  estimateResearchReportUsageCost,
  reserveResearchReportRequestCost,
} from "../../modules/research-reports/analysis/pricing.ts"
import { inspectOpenAiResponseEnvelope } from "../../modules/ai/openai-response.ts"

test("QEO-85 reads cache-write token usage from OpenAI Responses", () => {
  const inspection = inspectOpenAiResponseEnvelope({
    status: "completed",
    usage: {
      input_tokens: 10_000,
      input_tokens_details: {
        cached_tokens: 2_000,
        cache_write_tokens: 1_000,
      },
      output_tokens: 2_000,
      output_tokens_details: { reasoning_tokens: 500 },
      total_tokens: 12_000,
    },
  })

  assert.equal(inspection.cacheWriteTokens, 1_000)
  assert.equal(inspection.reasoningTokens, 500)
})

test("QEO-85 prices Luna standard usage without double-billing reasoning tokens", () => {
  const result = estimateResearchReportUsageCost({
    model: "gpt-5.6-luna",
    inputTokens: 10_000,
    cachedInputTokens: 2_000,
    cacheWriteTokens: 1_000,
    outputTokens: 2_000,
  })

  assert.equal(result.pricingVersion, RESEARCH_REPORT_PRICING_VERSION)
  assert.equal(result.estimatedCostUsd, 0.00409)
})

test("QEO-85 prices Terra using the fallback model rates", () => {
  const result = estimateResearchReportUsageCost({
    model: "gpt-5.6-terra",
    inputTokens: 10_000,
    cachedInputTokens: 2_000,
    cacheWriteTokens: 1_000,
    outputTokens: 2_000,
  })

  assert.equal(result.estimatedCostUsd, 0.0409)
})

test("QEO-85 applies the long-context multiplier to the full request above 272K input tokens", () => {
  const result = estimateResearchReportUsageCost({
    model: "gpt-5.6-luna",
    inputTokens: 300_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 10_000,
  })

  assert.equal(result.estimatedCostUsd, 0.138)
})

test("QEO-85 reserves conservatively using byte upper bound and selected model rates", () => {
  assert.equal(
    reserveResearchReportRequestCost({
      model: "gpt-5.6-luna",
      inputUtf8Bytes: 10_000,
      maxOutputTokens: 2_000,
    }),
    0.0049,
  )
  assert.equal(
    reserveResearchReportRequestCost({
      model: "gpt-5.6-terra",
      inputUtf8Bytes: 10_000,
      maxOutputTokens: 2_000,
    }),
    0.049,
  )
})

test("QEO-85 rejects unsupported pricing models instead of silently estimating with the wrong rate", () => {
  assert.throws(
    () => estimateResearchReportUsageCost({
      model: "gpt-4o-mini",
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
    }),
    /Unsupported research report pricing model/,
  )
})
