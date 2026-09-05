import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// QEO-81 nested research-report contracts are executed through this existing
// top-level AI suite because test-contracts.json intentionally classifies only
// tests/*.test.ts files and rejects nested manifest paths.
import "./research-reports/pdf-processing.test.ts"
import "./research-reports/analysis.test.ts"
import "./research-reports/pipeline.test.ts"
import "./research-reports/qa-retrieval.test.ts"
import "./research-reports/qa-schema.test.ts"
import "./research-reports/qa-openai.test.ts"
import "./research-reports/qa-service.test.ts"
import "./research-reports/qa-api.test.ts"
import "./research-reports/detail-service.test.ts"
import "./research-reports/pdf-api.test.ts"
import "./research-reports/detail-navigation.test.ts"
import "./research-reports/pdf-viewer.test.ts"
import "./research-reports/detail-analysis-ui.test.ts"
import "./research-reports/detail-chat-ui.test.ts"
import "./research-reports/detail-page.test.ts"
import "./research-reports/council-evidence.test.ts"
import "./research-reports/council-snapshot.test.ts"

import {
  extractOpenAiOutputText,
  inspectOpenAiResponseEnvelope as inspectSharedOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete as nextSharedMaxOutputTokensAfterIncomplete,
} from "../modules/ai/openai-response.ts"
import {
  inspectOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete,
} from "../modules/ai-council/openai-response.ts"
import {
  validateCouncilEvidenceRefs,
  type AiCouncilEvidencePacketV2,
  type LlmEvidenceRef,
} from "../modules/ai-council/prompt-evidence.ts"

function packetWithIndicator(key: string, value: number, unit: string): AiCouncilEvidencePacketV2 {
  return {
    packetVersion: "ai-council-evidence-v2",
    semanticGuideVersion: "insights-metric-semantics-v1",
    provenance: "test",
    ticker: "TEST",
    companyName: "Test Corp",
    sector: "Test",
    exchange: "HOSE",
    rank: 1,
    price: value,
    changePct: 0,
    asOf: "2026-08-26",
    evidenceHash: "hash",
    previousDeterministicSignal: null,
    observedIndicators: {
      [key]: { value, unit, asOf: "2026-08-26" },
    },
    missingIndicators: [],
    indicatorDictionary: [],
    deterministicDecision: {},
    deterministicAgents: [],
    deterministicBullCase: [],
    deterministicBearCase: [],
    marketBenchmark: {
      ticker: "VNINDEX",
      asOfDate: "2026-08-26",
      close: 1,
      sma20: 1,
      return20dPct: 0,
      regime: "above_sma20",
      freshness: "current",
      source: "test",
    },
    weightProfile: {
      source: "default",
      sampleCount: 0,
      calibrationVersion: "test",
      weights: {},
    },
  }
}

test("incomplete Responses API envelope preserves reason and usage for bounded retry", () => {
  const result = inspectOpenAiResponseEnvelope({
    id: "resp_1",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [],
    usage: {
      input_tokens: 321,
      output_tokens: 2000,
      total_tokens: 2321,
      input_tokens_details: { cached_tokens: 120 },
      output_tokens_details: { reasoning_tokens: 1800 },
    },
  })

  assert.equal(result.status, "incomplete")
  assert.equal(result.incompleteReason, "max_output_tokens")
  assert.equal(result.inputTokens, 321)
  assert.equal(result.cachedInputTokens, 120)
  assert.equal(result.outputTokens, 2000)
  assert.equal(result.reasoningTokens, 1800)
  assert.equal(result.totalTokens, 2321)
})

test("shared OpenAI helper preserves the Council envelope contract", () => {
  const result = inspectSharedOpenAiResponseEnvelope({
    id: "resp_shared",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    output: [],
    usage: {
      input_tokens: 321,
      output_tokens: 2000,
      total_tokens: 2321,
      input_tokens_details: { cached_tokens: 120 },
      output_tokens_details: { reasoning_tokens: 1800 },
    },
  })

  assert.equal(result.status, "incomplete")
  assert.equal(result.incompleteReason, "max_output_tokens")
  assert.equal(result.cachedInputTokens, 120)
  assert.equal(result.reasoningTokens, 1800)
  assert.equal(result.totalTokens, 2321)
})

test("shared OpenAI helper extracts root and nested output text while rejecting refusals", () => {
  assert.equal(extractOpenAiOutputText({ output_text: "root" }), "root")
  assert.equal(extractOpenAiOutputText({ output: [{ content: [{ type: "output_text", text: "nested" }] }] }), "nested")
  assert.equal(extractOpenAiOutputText({ output: [{ content: [{ type: "refusal", refusal: "no" }] }] }), "")
})

test("max-output retry is bounded and materially increases the budget", () => {
  assert.equal(nextMaxOutputTokensAfterIncomplete(3500, "max_output_tokens"), 6000)
  assert.equal(nextMaxOutputTokensAfterIncomplete(3500, "other"), null)
  assert.equal(nextMaxOutputTokensAfterIncomplete(7000, "max_output_tokens"), null)
  assert.equal(nextSharedMaxOutputTokensAfterIncomplete(3500, "max_output_tokens"), 6000)
})

test("score evidenceRef accepts harmless /100 unit suffix while preserving exact numeric value", () => {
  const packet = packetWithIndicator("rs_medium", 62.2, "score_0_100")
  const result = validateCouncilEvidenceRefs("bull", [{
    metricKey: "rs_medium",
    observedValue: "62.2/100",
    asOf: "2026-08-26",
    interpretation: "RS-M remains above the midpoint.",
  }], packet)

  assert.equal(result.valid, true)
})

test("evidenceRef still rejects a second metric smuggled into one observedValue", () => {
  const packet = packetWithIndicator("price_vs_sma10_pct", 2.46, "percent")
  const result = validateCouncilEvidenceRefs("bull", [{
    metricKey: "price_vs_sma10_pct",
    observedValue: "2.46% and RS-M 62.2/100",
    asOf: "2026-08-26",
    interpretation: "Do not accept concatenated metrics.",
  }], packet)

  assert.equal(result.valid, false)
  assert.match(result.errors.join("\n"), /does not match observed/i)
})

const llmSource = readFileSync(new URL("../modules/ai-council/llm.ts", import.meta.url), "utf8")

test("LLM runtime inspects incomplete_details and retries max-output truncation once before fallback", () => {
  assert.match(llmSource, /incompleteReason/)
  assert.match(llmSource, /max_output_tokens/)
  assert.match(llmSource, /nextMaxOutputTokensAfterIncomplete/)
  assert.match(llmSource, /currentMaxOutputTokens/)
})

test("specialist validation failure gets one bounded evidenceRef repair retry", () => {
  assert.match(llmSource, /validation repair/i)
  assert.match(llmSource, /repairAttempted/)
  assert.match(llmSource, /previous output failed structured evidence validation/i)
})

test("invalid escalation never erases a previously validated initial Chair", () => {
  assert.match(llmSource, /if \(!escalationCall\.payload\) return initial/)
})
