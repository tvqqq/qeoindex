import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// QEO-81 nested research-report contracts are executed through this existing
// top-level AI suite because test-contracts.json intentionally classifies only
// tests/*.test.ts files and rejects nested manifest paths.
import "./research-reports/pdf-processing.test.ts"
import "./research-reports/analysis.test.ts"
import "./research-reports/pipeline.test.ts"

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
    semanticGuideVersion: "test",
    provenance: "test",
    ticker: "MSN",
    companyName: "Masan",
    sector: "Thực phẩm",
    exchange: "HOSE",
    rank: 24,
    price: 70,
    changePct: 0.29,
    asOf: "2026-08-24",
    evidenceHash: "evidence",
    previousDeterministicSignal: null,
    observedIndicators: {
      [key]: { value, unit, asOf: "2026-08-24" },
    },
    missingIndicators: [],
    indicatorDictionary: [],
    deterministicDecision: {},
    deterministicAgents: [],
    deterministicBullCase: [],
    deterministicBearCase: [],
    marketBenchmark: {
      symbol: "VNINDEX",
      sessionDate: "2026-08-24",
      close: 1700,
      sma20: 1650,
      return20dPct: 3,
      regime: "RISK_ON",
      providerDetail: "test",
    },
    weightProfile: {
      source: "static",
      sampleCount: 0,
      calibrationVersion: "static-v1",
      weights: {},
    },
  }
}

test("incomplete Responses API envelope preserves reason and usage for bounded retry", () => {
  const inspected = inspectOpenAiResponseEnvelope({
    id: "resp_123",
    model: "gpt-5.6-luna",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 40 },
      output_tokens: 80,
      output_tokens_details: { reasoning_tokens: 30 },
      total_tokens: 180,
    },
  })

  assert.equal(inspected.status, "incomplete")
  assert.equal(inspected.incompleteReason, "max_output_tokens")
  assert.equal(inspected.responseId, "resp_123")
  assert.equal(inspected.responseModel, "gpt-5.6-luna")
  assert.equal(inspected.inputTokens, 100)
  assert.equal(inspected.cachedInputTokens, 40)
  assert.equal(inspected.outputTokens, 80)
  assert.equal(inspected.reasoningTokens, 30)
  assert.equal(inspected.totalTokens, 180)
  assert.equal(inspected.shouldRetryWithMoreOutput, true)
})

test("shared OpenAI helper preserves the Council envelope contract", () => {
  const fixture = {
    id: "resp_shared",
    model: "gpt-5.6-terra",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 60 },
      output_tokens: 90,
      output_tokens_details: { reasoning_tokens: 35 },
      total_tokens: 210,
    },
  }

  assert.deepEqual(inspectSharedOpenAiResponseEnvelope(fixture), inspectOpenAiResponseEnvelope(fixture))
  assert.equal(nextSharedMaxOutputTokensAfterIncomplete(900), nextMaxOutputTokensAfterIncomplete(900))
})

test("shared OpenAI helper extracts root and nested output text while rejecting refusals", () => {
  assert.equal(extractOpenAiOutputText({ output_text: " root result " }), "root result")
  assert.equal(extractOpenAiOutputText({
    output: [{ content: [{ type: "output_text", text: " nested result " }] }],
  }), "nested result")
  assert.throws(() => extractOpenAiOutputText({
    output: [{ content: [{ type: "refusal", refusal: "cannot comply" }] }],
  }), /refusal/i)
  assert.throws(() => extractOpenAiOutputText({ output: [] }), /no structured output text/i)
})

test("max-output retry is bounded and materially increases the budget", () => {
  assert.equal(nextMaxOutputTokensAfterIncomplete(900), 1800)
  assert.equal(nextMaxOutputTokensAfterIncomplete(1800), 2400)
  assert.equal(nextMaxOutputTokensAfterIncomplete(2400), null)
})

test("score evidenceRef accepts harmless /100 unit suffix while preserving exact numeric value", () => {
  const packet = packetWithIndicator("ttai.taScore", 54.5, "score")
  const refs: LlmEvidenceRef[] = [{
    source: "ttai",
    key: "ttai.taScore",
    asOf: packet.asOf,
    observedValue: "54.5/100",
    interpretation: "TA score is slightly above neutral.",
  }]
  assert.doesNotThrow(() => validateCouncilEvidenceRefs(packet, refs))
})

test("evidenceRef still rejects a second metric smuggled into one observedValue", () => {
  const packet = packetWithIndicator("ttai.taScore", 54.5, "score")
  const refs: LlmEvidenceRef[] = [{
    source: "ttai",
    key: "ttai.taScore",
    asOf: packet.asOf,
    observedValue: "54.5/100, RS-S 89.7/100",
    interpretation: "Two metrics are being combined improperly.",
  }]
  assert.throws(() => validateCouncilEvidenceRefs(packet, refs), /does not match packet value/i)
})

test("LLM runtime inspects incomplete_details and retries max-output truncation once before fallback", () => {
  const source = readFileSync("modules/ai-council/llm.ts", "utf8")
  assert.match(source, /inspectOpenAiResponseEnvelope\(response\)/)
  assert.match(source, /nextMaxOutputTokensAfterIncomplete\(maxOutputTokens\)/)
  assert.match(source, /for\s*\(let\s+attempt\s*=\s*0;\s*attempt\s*<\s*2;/)
  assert.match(source, /shouldRetryWithMoreOutput/)
})

test("specialist validation failure gets one bounded evidenceRef repair retry", () => {
  const source = readFileSync("modules/ai-council/llm.ts", "utf8")
  assert.match(source, /const\s+MAX_EVIDENCE_REPAIR_ATTEMPTS\s*=\s*1/)
  assert.match(source, /retryInvalidEvidence/)
  assert.match(source, /Evidence validation error:/)
})

test("invalid escalation never erases a previously validated initial Chair", () => {
  const source = readFileSync("modules/ai-council/llm.ts", "utf8")
  assert.match(source, /const initialChair = await callCouncilModel<[\s\S]*?validateChairOutput/)
  assert.match(source, /let chair = initialChair/)
  assert.match(source, /catch\s*\(error\)\s*\{[\s\S]*?console\.warn\("AI Council Sol escalation failed; keeping validated initial Chair"/)
})
