export const RESEARCH_REPORT_PRICING_VERSION = "openai-gpt-5.6-standard-2026-09-05" as const

const TOKENS_PER_MILLION = 1_000_000
const LONG_CONTEXT_INPUT_THRESHOLD = 272_000

interface ModelRates {
  input: number
  cachedInput: number
  cacheWrite: number
  output: number
}

const MODEL_RATES: Record<string, ModelRates> = {
  "gpt-5.6-luna": {
    input: 0.20,
    cachedInput: 0.02,
    cacheWrite: 0.25,
    output: 1.20,
  },
  "gpt-5.6-terra": {
    input: 2.00,
    cachedInput: 0.20,
    cacheWrite: 2.50,
    output: 12.00,
  },
}

export interface ResearchReportUsageCostInput {
  model: string
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

export interface ResearchReportUsageCost {
  estimatedCostUsd: number
  pricingVersion: typeof RESEARCH_REPORT_PRICING_VERSION
}

function nonNegativeFinite(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`)
  }
  return value
}

function roundUsd(value: number) {
  return Number(value.toFixed(12))
}

export function estimateResearchReportUsageCost(
  input: ResearchReportUsageCostInput,
): ResearchReportUsageCost {
  const rates = MODEL_RATES[input.model]
  if (!rates) throw new Error(`Unsupported research report pricing model: ${input.model}`)

  const inputTokens = nonNegativeFinite(input.inputTokens, "inputTokens")
  const cachedInputTokens = nonNegativeFinite(input.cachedInputTokens, "cachedInputTokens")
  const cacheWriteTokens = nonNegativeFinite(input.cacheWriteTokens, "cacheWriteTokens")
  const outputTokens = nonNegativeFinite(input.outputTokens, "outputTokens")
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens)

  const isLongContext = inputTokens > LONG_CONTEXT_INPUT_THRESHOLD
  const inputMultiplier = isLongContext ? 2 : 1
  const outputMultiplier = isLongContext ? 1.5 : 1

  const estimatedCostUsd = (
    uncachedInputTokens * rates.input * inputMultiplier
    + cachedInputTokens * rates.cachedInput * inputMultiplier
    + cacheWriteTokens * rates.cacheWrite * inputMultiplier
    + outputTokens * rates.output * outputMultiplier
  ) / TOKENS_PER_MILLION

  return {
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    pricingVersion: RESEARCH_REPORT_PRICING_VERSION,
  }
}
