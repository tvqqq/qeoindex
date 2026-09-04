import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  buildAiCouncilEvidencePacketV2,
  validateCouncilEvidenceRefs,
  type LlmEvidenceRef,
} from "../modules/ai-council/prompt-evidence.ts"
import { INSIGHTS_METRIC_GUIDE_VERSION } from "../modules/research/insights/metric-semantics.ts"
import type { CouncilBenchmarkContext } from "../modules/ai-council/market"
import type { CouncilWeightProfile } from "../modules/ai-council/calibration"
import { buildAiCouncilPromptCacheKey, buildAiCouncilPromptIdentityHash, resolveAiCouncilPromptIdentityHash } from "../modules/ai-council/prompt-identity.ts"

const mockBenchmark: CouncilBenchmarkContext = {
  symbol: "VNINDEX",
  sessionDate: "2026-08-24",
  close: 1280.5,
  sma20: 1265.0,
  return20dPct: 2.5,
  regime: "RISK_ON",
  providerDetail: "mock",
}

const mockWeightProfile: CouncilWeightProfile = {
  source: "static",
  sampleCount: 100,
  calibrationVersion: "static-v1",
  regime: "RISK_ON",
  weights: {
    wyckoff: 0.3,
    momentum: 0.2,
    fundamental: 0.2,
    flow: 0.15,
    market: 0.15,
  },
}

const mockStock = {
  ticker: "FPT",
  companyName: "Công ty Cổ phần FPT",
  sector: "Công nghệ thông tin",
  exchange: "HOSE",
  rank: 1,
  price: 135.0,
  changePct: 2.1,
  asOf: "2026-08-24",
  evidenceHash: "abcdef1234567890",
  signal: "BUY",
  signalLabel: "BUY",
  councilScore: 82,
  confidence: 85,
  consensus: 78,
  bullVotes: 4,
  neutralVotes: 1,
  bearVotes: 0,
  riskStatus: "approve",
  confirmationPending: false,
  support: "130.0",
  resistance: "140.0",
  confirmation: "Break 136 with volume",
  invalidation: "Close below 129",
  dataQuality: "HIGH",
  dataQualityDetail: "Complete ratings and Wyckoff MTF snapshots",
  dissent: "None",
  whatChangesDecision: ["Close below SMA20"],
  agents: [],
  bullCase: ["Strong momentum and fundamentals"],
  bearCase: ["Valuation near upper band"],
  promptEvidence: {
    rating: {
      ticker: "FPT",
      companyName: "FPT",
      sector: "Công nghệ thông tin",
      exchange: "HOSE",
      rank: 1,
      price: 135.0,
      changePct: 2.1,
      ratingScore: 88,
      score4m: 85,
      canslimScore: 82,
      pricePotential: "Tăng 15%",
      stockRsScore: 89,
      sectorRsScore: 76,
      rsShort: 88,
      rsMedium: 84,
      stockRrgState: "Dẫn dắt",
      sectorRrgState: "Dẫn dắt",
      weeklyChangePct: 3.5,
      monthlyChangePct: 8.2,
      beta: 0.95,
      peTtm: 22.5,
      pbTtm: 5.1,
      fundamentals: {
        revenueGrowthPct: 21.5,
        netIncomeGrowthPct: 22.0,
        roePct: 28.5,
        roaPct: 12.0,
        netMarginPct: 16.5,
      },
      technical: {
        priceVsSma10Pct: 2.1,
        priceVsSma20Pct: 4.5,
        priceVsSma50Pct: 9.2,
        priceVsSma100Pct: 15.0,
        priceVsSma200Pct: 22.0,
        macdVsSignal: "Trên Signal",
      },
      liquidity: {
        volume1d: 4500000,
        averageVolume10d: 3800000,
        averageVolume20d: 3500000,
        averageVolume50d: 3200000,
        volumeVsPreviousSessionPct: 15.5,
        tradedValueVsPreviousSessionPct: 18.2,
      },
      flow: {
        netForeignTradingBillion: 45.2,
        netProprietaryTradingBillion: 12.8,
      },
    },
    snapshots: [],
    ratingDate: "2026-08-24",
    evidenceHash: "abcdef1234567890",
  },
}

test("buildAiCouncilEvidencePacketV2 creates a valid Packet V2 with semantic grounding", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  assert.equal(packet.packetVersion, "ai-council-evidence-v2")
  assert.equal(packet.semanticGuideVersion, INSIGHTS_METRIC_GUIDE_VERSION)
  assert.equal(packet.ticker, "FPT")
  assert.ok(packet.observedIndicators.kfsp_score_4m)
  assert.equal(packet.observedIndicators.kfsp_score_4m.value, 85)
  assert.equal(packet.observedIndicators.kfsp_score_4m.unit, "score_0_100")
  assert.equal(packet.observedIndicators.vnindex_regime.value, "RISK_ON")
  assert.ok(packet.indicatorDictionary.length > 0)
  assert.ok(packet.indicatorDictionary.some((d) => d.key === "kfsp_score_4m"))
})

test("validateCouncilEvidenceRefs accepts accurate evidenceRefs in bounds", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  const validRefs: LlmEvidenceRef[] = [
    {
      metricKey: "kfsp_score_4m",
      observedValue: "85",
      asOf: "2026-08-24",
      interpretation: "High business quality score",
    },
    {
      metricKey: "rs_short",
      observedValue: "88",
      asOf: "2026-08-24",
      interpretation: "Strong short-term relative strength",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", validRefs, packet)
  assert.equal(result.valid, true)
  assert.equal(result.errors.length, 0)
})

test("validateCouncilEvidenceRefs rejects missing metric cited as positive evidence in Bull/Bear", () => {
  const stockWithMissing = {
    ...mockStock,
    promptEvidence: {
      ...mockStock.promptEvidence,
      rating: {
        ...mockStock.promptEvidence.rating,
        beta: null,
      },
    },
  }

  const packet = buildAiCouncilEvidencePacketV2({
    stock: stockWithMissing,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  assert.ok(packet.missingIndicators.includes("beta"))

  const invalidRefs: LlmEvidenceRef[] = [
    {
      metricKey: "beta",
      observedValue: "1.0",
      asOf: "2026-08-24",
      interpretation: "Neutral beta",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", invalidRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("cannot be cited as positive evidence")))
})

test("validateCouncilEvidenceRefs rejects mismatched observed value", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  const mismatchedRefs: LlmEvidenceRef[] = [
    {
      metricKey: "kfsp_score_4m",
      observedValue: "40", // actual is 85
      asOf: "2026-08-24",
      interpretation: "Weak 4M score",
    },
  ]

  const result = validateCouncilEvidenceRefs("bear", mismatchedRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("does not match observed")))
})

test("validateCouncilEvidenceRefs rejects empty or out-of-bounds refs", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  const emptyResult = validateCouncilEvidenceRefs("bull", [], packet)
  assert.equal(emptyResult.valid, false)

  const tooManyRefs: LlmEvidenceRef[] = [
    { metricKey: "price", observedValue: "135", asOf: null, interpretation: "1" },
    { metricKey: "rs_short", observedValue: "88", asOf: null, interpretation: "2" },
    { metricKey: "rs_medium", observedValue: "84", asOf: null, interpretation: "3" },
    { metricKey: "kfsp_score_4m", observedValue: "85", asOf: null, interpretation: "4" },
    { metricKey: "kfsp_canslim_score", observedValue: "82", asOf: null, interpretation: "5" },
  ]
  const tooManyResult = validateCouncilEvidenceRefs("bull", tooManyRefs, packet)
  assert.equal(tooManyResult.valid, false)
  assert.ok(tooManyResult.errors.some((e) => e.includes("exceeds maximum 4")))
})

test("validateCouncilEvidenceRefs rejects empty or whitespace observedValue", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  const emptyValRefs: LlmEvidenceRef[] = [
    {
      metricKey: "kfsp_score_4m",
      observedValue: "   ",
      asOf: "2026-08-24",
      interpretation: "Score is strong",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", emptyValRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("observedValue must be a non-empty string")))
})

test("validateCouncilEvidenceRefs rejects empty or whitespace interpretation", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  const emptyInterpRefs: LlmEvidenceRef[] = [
    {
      metricKey: "kfsp_score_4m",
      observedValue: "85",
      asOf: "2026-08-24",
      interpretation: "",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", emptyInterpRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("interpretation must be a non-empty string")))
})

test("validateCouncilEvidenceRefs rejects mismatched asOf date", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  const wrongAsOfRefs: LlmEvidenceRef[] = [
    {
      metricKey: "kfsp_score_4m",
      observedValue: "85",
      asOf: "2026-08-20", // packet asOf is 2026-08-24
      interpretation: "Score is strong",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", wrongAsOfRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("does not match observed asOf")))

  const missingAsOfRefs: LlmEvidenceRef[] = [
    {
      metricKey: "kfsp_score_4m",
      observedValue: "85",
      asOf: null, // packet asOf is 2026-08-24
      interpretation: "Score is strong",
    },
  ]

  const nullResult = validateCouncilEvidenceRefs("bull", missingAsOfRefs, packet)
  assert.equal(nullResult.valid, false)
  assert.ok(nullResult.errors.some((e) => e.includes("does not match observed asOf")))
})

test("validateCouncilEvidenceRefs rejects prefix false-positive numeric match (13 vs 135)", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  // mockStock.price is 135.0. A prefix match would have erroneously accepted "13"
  const prefixRefs: LlmEvidenceRef[] = [
    {
      metricKey: "price",
      observedValue: "13",
      asOf: "2026-08-24",
      interpretation: "Price test",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", prefixRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("does not match observed")))
})

test("validateCouncilEvidenceRefs enforces exact numeric equality (rejecting even slight 0.01 tolerance)", () => {
  const packet = buildAiCouncilEvidencePacketV2({
    stock: mockStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  // mockStock.price is 135.0
  const slightMismatchRefs: LlmEvidenceRef[] = [
    {
      metricKey: "price",
      observedValue: "135.01",
      asOf: "2026-08-24",
      interpretation: "Price test slight mismatch",
    },
  ]

  const result = validateCouncilEvidenceRefs("bull", slightMismatchRefs, packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes("does not match observed")))

  // But exact formatting variation (135.0 or 135) is accepted
  const exactFormattedRefs: LlmEvidenceRef[] = [
    {
      metricKey: "price",
      observedValue: "135",
      asOf: "2026-08-24",
      interpretation: "Exact price",
    },
  ]
  const validResult = validateCouncilEvidenceRefs("bull", exactFormattedRefs, packet)
  assert.equal(validResult.valid, true)
})

test("first-class raw/research context is explicit and prompt identity is stable", () => {
  const rawContextHash = "a".repeat(64)
  const researchContextHash = "b".repeat(64)
  const promptIdentityHash = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash: mockStock.evidenceHash,
    rawContextHash,
    researchContextHash,
    promptVersion: "llm-debate-v3-first-class-context",
  })
  const contextualStock = {
    ...mockStock,
    llmEvidence: {
      contextVersion: "llm-evidence-fidelity-v1",
      contextHash: rawContextHash,
      rawEvidence: { providerSnapshot: { score4m: 85 }, ttaiQuarterlyHistory: [], wyckoffMtf: [] },
      wyckoffContext: [],
    },
    researchContext: {
      contextVersion: "notion-research-context-v1",
      contextHash: researchContextHash,
      rawContextHash,
      promptIdentityHash,
      context: { status: "ready", sourceHierarchy: "S>A>B>C>D" },
    },
  }

  const packet = buildAiCouncilEvidencePacketV2({
    stock: contextualStock,
    benchmark: mockBenchmark,
    weightProfile: mockWeightProfile,
    previousSignal: "BUY",
  })

  assert.equal((packet.rawEvidence as { contextHash: string }).contextHash, rawContextHash)
  assert.equal((packet.researchContext as { promptIdentityHash: string }).promptIdentityHash, promptIdentityHash)
  assert.equal(
    resolveAiCouncilPromptIdentityHash(contextualStock, "llm-debate-v3-first-class-context"),
    promptIdentityHash,
  )
  assert.equal(buildAiCouncilPromptCacheKey(promptIdentityHash), `qeo-council-${promptIdentityHash.slice(0, 48)}`)
})


test("prompt identity recomputes when immutable research context predates the current prompt version", () => {
  const rawContextHash = "c".repeat(64)
  const researchContextHash = "d".repeat(64)
  const staleIdentity = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash: mockStock.evidenceHash,
    rawContextHash,
    researchContextHash,
    promptVersion: "llm-debate-v2-semantic-grounding",
  })
  const currentIdentity = buildAiCouncilPromptIdentityHash({
    deterministicEvidenceHash: mockStock.evidenceHash,
    rawContextHash,
    researchContextHash,
    promptVersion: "llm-debate-v3-first-class-context",
  })

  assert.notEqual(staleIdentity, currentIdentity)
  assert.equal(
    resolveAiCouncilPromptIdentityHash({
      evidenceHash: mockStock.evidenceHash,
      llmEvidence: { contextHash: rawContextHash },
      researchContext: { contextHash: researchContextHash, promptIdentityHash: staleIdentity },
    }, "llm-debate-v3-first-class-context"),
    currentIdentity,
  )
})

test("AI Council LLM router respects runtimeConfig overrides without mutating env", () => {
  const code = readFileSync(new URL("../modules/ai-council/llm.ts", import.meta.url), "utf8")
  assert.match(code, /runtimeConfig\?: AiCouncilRuntimeConfig/)
  assert.match(code, /params\.runtimeConfig\?\.llmEnabled/)
  assert.match(code, /runtimeConfig\?\.tickers/)
  assert.match(code, /runtimeConfig\?\.maxTickers/)
})


