import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  inspectOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete,
} from "../lib/ai-council-openai-response.ts"
import {
  validateCouncilEvidenceRefs,
  type AiCouncilEvidencePacketV2,
  type LlmEvidenceRef,
} from "../lib/ai-council-prompt-evidence.ts"

function packetWithIndicator(key: string, value: number | string, unit: string): AiCouncilEvidencePacketV2 {
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
    id: "resp_test",
    status: "incomplete",
    model: "gpt-5.6-luna",
    incomplete_details: { reason: "max_output_tokens" },
    usage: {
      input_tokens: 1234,
      input_tokens_details: { cached_tokens: 456 },
      output_tokens: 650,
      output_tokens_details: { reasoning_tokens: 520 },
      total_tokens: 1884,
    },
    output: [],
  })

  assert.equal(inspected.status, "incomplete")
  assert.equal(inspected.incompleteReason, "max_output_tokens")
  assert.equal(inspected.responseId, "resp_test")
  assert.equal(inspected.responseModel, "gpt-5.6-luna")
  assert.equal(inspected.inputTokens, 1234)
  assert.equal(inspected.cachedInputTokens, 456)
  assert.equal(inspected.outputTokens, 650)
  assert.equal(inspected.reasoningTokens, 520)
  assert.equal(inspected.totalTokens, 1884)
  assert.equal(inspected.shouldRetryWithMoreOutput, true)
})

test("max-output retry is bounded and materially increases the budget", () => {
  assert.equal(nextMaxOutputTokensAfterIncomplete(650), 1400)
  assert.equal(nextMaxOutputTokensAfterIncomplete(800), 1600)
  assert.equal(nextMaxOutputTokensAfterIncomplete(1800), 2400)
  assert.equal(nextMaxOutputTokensAfterIncomplete(2400), null)
})

test("score evidenceRef accepts harmless /100 unit suffix while preserving exact numeric value", () => {
  const packet = packetWithIndicator("kfsp_score_4m", 31.286025327989, "score_0_100")
  const refs: LlmEvidenceRef[] = [{
    metricKey: "kfsp_score_4m",
    observedValue: "31.286025327989/100",
    asOf: "2026-08-24",
    interpretation: "Điểm 4M hiện ở mức thấp.",
  }]

  const result = validateCouncilEvidenceRefs("risk", refs, packet)
  assert.equal(result.valid, true, result.errors.join(" | "))
})

test("text evidenceRef accepts only its harmless semantic unit suffix", () => {
  const packet = packetWithIndicator("macd_vs_signal", "Trên", "text")
  const valid = validateCouncilEvidenceRefs("bear", [{
    metricKey: "macd_vs_signal",
    observedValue: "Trên text",
    asOf: "2026-08-24",
    interpretation: "MACD đang trên signal.",
  }], packet)
  assert.equal(valid.valid, true, valid.errors.join(" | "))

  const wrong = validateCouncilEvidenceRefs("bear", [{
    metricKey: "macd_vs_signal",
    observedValue: "Dưới text",
    asOf: "2026-08-24",
    interpretation: "Sai giá trị phải bị chặn.",
  }], packet)
  assert.equal(wrong.valid, false)
})

test("evidenceRef still rejects a second metric smuggled into one observedValue", () => {
  const packet = packetWithIndicator("volume_1d", 7_435_200, "shares")
  const refs: LlmEvidenceRef[] = [{
    metricKey: "volume_1d",
    observedValue: "7,435,200; average_volume_20d: 4,160,645",
    asOf: "2026-08-24",
    interpretation: "Thanh khoản cao hơn bình quân.",
  }]

  const result = validateCouncilEvidenceRefs("risk", refs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes("does not match observed")))
})

test("LLM runtime inspects incomplete_details and retries max-output truncation once before fallback", () => {
  const code = readFileSync(new URL("../lib/ai-council-llm.ts", import.meta.url), "utf8")
  assert.match(code, /inspectOpenAiResponseEnvelope/)
  assert.match(code, /nextMaxOutputTokensAfterIncomplete/)
  assert.match(code, /callModelWithOutputRetry/)
  assert.match(code, /shouldRetryWithMoreOutput/)
  assert.match(code, /maxOutputTokens: 1400/)
  assert.match(code, /maxOutputTokens: 1600/)
  assert.match(code, /maxOutputTokens: 2000/)
})

test("specialist validation failure gets one bounded evidenceRef repair retry", () => {
  const code = readFileSync(new URL("../lib/ai-council-llm.ts", import.meta.url), "utf8")
  const start = code.indexOf("async function settleRole")
  const end = code.indexOf("function reasonCounts", start)
  assert.ok(start >= 0 && end > start)
  const block = code.slice(start, end)

  assert.match(block, /VALIDATION_REPAIR/)
  assert.match(block, /execute\(validationRepair/)
  assert.match(block, /validateCouncilEvidenceRefs\(role, repairedResult\.payload\.evidenceRefs, packet\)/)
  assert.match(code, /observedValue must contain ONLY the value for metricKey/i)
  assert.match(code, /comparisons belong in interpretation/i)
})

test("invalid escalation never erases a previously validated initial Chair", () => {
  const code = readFileSync(new URL("../lib/ai-council-llm.ts", import.meta.url), "utf8")
  const start = code.indexOf('schemaName: "qeoindex_llm_escalation_chair"')
  const end = code.indexOf("const audits =", start)
  assert.ok(start >= 0 && end > start)
  const block = code.slice(start, end)

  assert.doesNotMatch(block, /if \(!validation\.valid\) \{[\s\S]{0,220}chair\s*=\s*null/)
  assert.match(block, /chair = escalationResult\.payload/)
})
