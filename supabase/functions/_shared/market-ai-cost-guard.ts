export interface MarketAiPricing {
  inputRate: number
  outputRate: number
}

export interface MarketAiCostGuardPlan {
  promptChars: number
  promptTokenEstimate: number
  inputTokenReserve: number
  guardedInputTokens: number
  requestedMaxOutputTokens: number
  maxOutputTokens: number
  estimatedCostUsd: number
}

export function estimateMarketAiCost(inputTokens: number, outputTokens: number, pricing: MarketAiPricing) {
  const cost = (inputTokens * pricing.inputRate + outputTokens * pricing.outputRate) / 1_000_000
  return Number(cost.toFixed(6))
}

export function planMarketAiCostGuard(input: {
  promptChars: number
  requestedMaxOutputTokens: number
  inputTokenReserve: number
  maxCostUsd: number
  pricing: MarketAiPricing
}): MarketAiCostGuardPlan {
  const promptChars = Math.max(0, Math.trunc(input.promptChars))
  const requestedMaxOutputTokens = Math.max(0, Math.trunc(input.requestedMaxOutputTokens))
  const inputTokenReserve = Math.max(0, Math.trunc(input.inputTokenReserve))
  const promptTokenEstimate = Math.ceil(promptChars / 3)
  const guardedInputTokens = promptTokenEstimate + inputTokenReserve
  const budgetMicros = Math.floor(Math.max(0, input.maxCostUsd) * 1_000_000)
  const inputMicros = guardedInputTokens * input.pricing.inputRate
  const affordableOutputTokens = input.pricing.outputRate === 0
    ? requestedMaxOutputTokens
    : Math.floor(Math.max(0, budgetMicros - inputMicros) / input.pricing.outputRate)
  const maxOutputTokens = Math.min(requestedMaxOutputTokens, Math.max(0, affordableOutputTokens))

  return {
    promptChars,
    promptTokenEstimate,
    inputTokenReserve,
    guardedInputTokens,
    requestedMaxOutputTokens,
    maxOutputTokens,
    estimatedCostUsd: estimateMarketAiCost(guardedInputTokens, maxOutputTokens, input.pricing),
  }
}
