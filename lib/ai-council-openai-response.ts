export interface OpenAiResponseEnvelopeInspection {
  status: string
  incompleteReason: string | null
  responseId: string | null
  responseModel: string | null
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  shouldRetryWithMoreOutput: boolean
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function finiteToken(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function inspectOpenAiResponseEnvelope(raw: unknown): OpenAiResponseEnvelopeInspection {
  const root = record(raw)
  const incompleteDetails = record(root.incomplete_details)
  const usage = record(root.usage)
  const inputDetails = record(usage.input_tokens_details)
  const outputDetails = record(usage.output_tokens_details)
  const status = typeof root.status === "string" ? root.status : "unknown"
  const incompleteReason = typeof incompleteDetails.reason === "string"
    ? incompleteDetails.reason
    : null

  return {
    status,
    incompleteReason,
    responseId: typeof root.id === "string" ? root.id : null,
    responseModel: typeof root.model === "string" ? root.model : null,
    inputTokens: finiteToken(usage.input_tokens),
    cachedInputTokens: finiteToken(inputDetails.cached_tokens),
    outputTokens: finiteToken(usage.output_tokens),
    reasoningTokens: finiteToken(outputDetails.reasoning_tokens),
    totalTokens: finiteToken(usage.total_tokens),
    shouldRetryWithMoreOutput: status === "incomplete" && incompleteReason === "max_output_tokens",
  }
}

const MAX_RETRY_OUTPUT_TOKENS = 2400

/**
 * Returns one materially larger bounded budget for an incomplete response.
 * Callers should retry a given model at most once with this value, then
 * continue to their normal fallback policy.
 */
export function nextMaxOutputTokensAfterIncomplete(current: number): number | null {
  if (!Number.isFinite(current) || current <= 0) return 1400
  if (current >= MAX_RETRY_OUTPUT_TOKENS) return null
  return Math.min(MAX_RETRY_OUTPUT_TOKENS, Math.max(1400, Math.round(current * 2)))
}
