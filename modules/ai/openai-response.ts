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

export class OpenAiResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OpenAiResponseError"
  }
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

export function extractOpenAiOutputText(raw: unknown): string {
  const root = record(raw)
  if (typeof root.output_text === "string" && root.output_text.trim()) {
    return root.output_text.trim()
  }

  const output = Array.isArray(root.output) ? root.output : []
  for (const item of output) {
    const itemRecord = record(item)
    const content = Array.isArray(itemRecord.content) ? itemRecord.content : []
    for (const child of content) {
      const contentRecord = record(child)
      if (contentRecord.type === "refusal" && typeof contentRecord.refusal === "string") {
        throw new OpenAiResponseError(`OpenAI refusal: ${contentRecord.refusal.slice(0, 240)}`)
      }
      if (
        contentRecord.type === "output_text"
        && typeof contentRecord.text === "string"
        && contentRecord.text.trim()
      ) {
        return contentRecord.text.trim()
      }
    }
  }

  throw new OpenAiResponseError("OpenAI response contained no structured output text")
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
