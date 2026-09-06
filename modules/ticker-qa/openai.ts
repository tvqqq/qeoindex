import { createHash } from "node:crypto"

import {
  extractOpenAiOutputText,
  inspectOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete,
  OpenAiResponseError,
  type OpenAiResponseEnvelopeInspection,
} from "../ai/openai-response.ts"
import type { TickerQaResolvedEvidence } from "./canonical.ts"
import {
  TICKER_QA_INSTRUCTIONS,
  TICKER_QA_PROMPT_VERSION,
  buildTickerQaInput,
} from "./prompt.ts"
import {
  TICKER_QA_JSON_SCHEMA,
  validateTickerQaModelOutput,
  type TickerQaModelOutput,
} from "./schema.ts"
import type { TickerQaTurn } from "./types.ts"

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const DEFAULT_MODEL = "gpt-5.6-luna"
const DEFAULT_FALLBACK_MODEL = "gpt-5.6-terra"
const DEFAULT_REASONING_EFFORT: TickerQaReasoningEffort = "medium"
const INITIAL_MAX_OUTPUT_TOKENS = 1_600
const REQUEST_TIMEOUT_MS = 30_000
const OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH = 64
const REPAIR_INSTRUCTION = "The previous structured result failed schema, authority, contradiction, or citation-grounding validation. Re-read the exact same immutable RESOLVED_EVIDENCE and return a corrected result. Do not add facts, figures, targets, recommendations, signals, evidence IDs, excerpts, authority labels, contradictions, or outside knowledge that are not supported by that evidence."

export type TickerQaReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

export interface TickerQaModelRoute {
  model: string
  fallbackModel: string
  reasoningEffort: TickerQaReasoningEffort
  modelRouteKey: string
}

export interface TickerQaProviderAudit {
  promptVersion: string
  requestedModel: string
  responseModel: string
  fallbackUsed: boolean
  attemptedModels: string[]
  responseId: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  latencyMs: number
}

export interface TickerQaOpenAiInput {
  ticker: string
  question: string
  history: readonly TickerQaTurn[]
  evidence: readonly TickerQaResolvedEvidence[]
}

export interface TickerQaOpenAiDependencies {
  fetchImpl?: typeof fetch
}

interface ProviderCallResult {
  inspection: OpenAiResponseEnvelopeInspection
  outputText: string
}

interface UsageAccumulator {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
}

class TickerQaProviderError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = "TickerQaProviderError"
    this.retryable = retryable
  }
}

class TickerQaIncompleteError extends Error {
  readonly inspection: OpenAiResponseEnvelopeInspection

  constructor(inspection: OpenAiResponseEnvelopeInspection) {
    super(`OpenAI response incomplete: ${inspection.incompleteReason ?? inspection.status ?? "unknown"}`)
    this.name = "TickerQaIncompleteError"
    this.inspection = inspection
  }
}

export class TickerQaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TickerQaValidationError"
  }
}

const ALLOWED_REASONING_EFFORTS = new Set<TickerQaReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])

function envModel(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback
}

function reasoningEffortFromEnv(): TickerQaReasoningEffort {
  const configured = process.env.TICKER_QA_REASONING_EFFORT?.trim().toLowerCase()
  if (configured && ALLOWED_REASONING_EFFORTS.has(configured as TickerQaReasoningEffort)) {
    return configured as TickerQaReasoningEffort
  }
  return DEFAULT_REASONING_EFFORT
}

export function getTickerQaModelRoute(): TickerQaModelRoute {
  const model = envModel("TICKER_QA_MODEL", DEFAULT_MODEL)
  const fallbackModel = envModel("TICKER_QA_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL)
  const reasoningEffort = reasoningEffortFromEnv()
  return {
    model,
    fallbackModel,
    reasoningEffort,
    modelRouteKey: `ticker-qa-v1:${model}:${fallbackModel}:${reasoningEffort}`,
  }
}

function promptCacheKey(input: TickerQaOpenAiInput) {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      promptVersion: TICKER_QA_PROMPT_VERSION,
      ticker: input.ticker,
      question: input.question,
      history: input.history,
      evidence: input.evidence.map((row) => ({
        evidenceId: row.evidenceId,
        id: row.item.id,
        knowledgeType: row.item.knowledgeType,
        authority: row.item.authority,
        sourceType: row.item.sourceType,
        sourceId: row.item.provenance.sourceId,
        sourceVersion: row.item.provenance.sourceVersion,
        reportId: row.item.provenance.reportId ?? null,
        analysisId: row.item.provenance.analysisId ?? null,
        contentHash: row.item.provenance.contentHash ?? null,
        chunkVersion: row.item.provenance.chunkVersion ?? null,
        page: row.item.provenance.page ?? null,
        runId: row.item.provenance.runId ?? null,
        text: row.text,
      })),
    }))
    .digest("hex")
  const prefix = `ticker-qa:${TICKER_QA_PROMPT_VERSION}:`
  return `${prefix}${digest.slice(0, Math.max(0, OPENAI_PROMPT_CACHE_KEY_MAX_LENGTH - prefix.length))}`
}

function safeProviderMessage(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const error = (value as { error?: unknown }).error
  if (!error || typeof error !== "object" || Array.isArray(error)) return null
  const message = (error as { message?: unknown }).message
  if (typeof message !== "string") return null
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || null
}

function addUsage(total: UsageAccumulator, inspection: OpenAiResponseEnvelopeInspection) {
  total.inputTokens += inspection.inputTokens
  total.cachedInputTokens += inspection.cachedInputTokens
  total.outputTokens += inspection.outputTokens
  total.reasoningTokens += inspection.reasoningTokens
  total.totalTokens += inspection.totalTokens
}

function parseValidatedOutput(
  outputText: string,
  evidence: readonly TickerQaResolvedEvidence[],
): TickerQaModelOutput {
  let parsed: unknown
  try {
    parsed = JSON.parse(outputText)
  } catch {
    throw new TickerQaValidationError("Ticker Q&A validation failed: provider output was not valid JSON")
  }

  try {
    return validateTickerQaModelOutput(parsed, evidence)
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid grounded ticker Q&A output"
    throw new TickerQaValidationError(`Ticker Q&A validation failed: ${message}`)
  }
}

async function callOpenAiOnce(
  model: string,
  reasoningEffort: TickerQaReasoningEffort,
  input: TickerQaOpenAiInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  maxOutputTokens: number,
  repair: boolean,
  usage: UsageAccumulator,
): Promise<ProviderCallResult> {
  const body = {
    model,
    instructions: repair ? `${TICKER_QA_INSTRUCTIONS}\n\n${REPAIR_INSTRUCTION}` : TICKER_QA_INSTRUCTIONS,
    input: buildTickerQaInput(input),
    reasoning: { effort: reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "ticker_qa",
        strict: true,
        schema: TICKER_QA_JSON_SCHEMA,
      },
    },
    prompt_cache_key: promptCacheKey(input),
    max_output_tokens: maxOutputTokens,
    store: false,
    tools: [],
  }

  let response: Response
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : "transport_error"
    throw new TickerQaProviderError(`OpenAI Responses request failed: ${name}`, true)
  }

  const rawText = await response.text()
  let envelope: unknown
  try {
    envelope = rawText ? JSON.parse(rawText) : {}
  } catch {
    throw new TickerQaProviderError(
      `OpenAI Responses API ${response.status} returned an invalid response envelope`,
      response.status === 429 || response.status >= 500,
    )
  }

  if (!response.ok) {
    const providerMessage = safeProviderMessage(envelope)
    const suffix = providerMessage ? `: ${providerMessage}` : ""
    throw new TickerQaProviderError(
      `OpenAI Responses API ${response.status}${suffix}`,
      response.status === 429 || response.status >= 500,
    )
  }

  const inspection = inspectOpenAiResponseEnvelope(envelope)
  addUsage(usage, inspection)
  if (inspection.status === "incomplete") throw new TickerQaIncompleteError(inspection)
  if (inspection.status === "failed") throw new TickerQaProviderError("OpenAI Responses provider returned failed status", true)

  try {
    return { inspection, outputText: extractOpenAiOutputText(envelope) }
  } catch (error) {
    if (error instanceof OpenAiResponseError) {
      const retryable = !/refus/i.test(error.message)
      throw new TickerQaProviderError(`OpenAI Responses output failure: ${error.message}`, retryable)
    }
    throw error
  }
}

async function callWithIncompleteRetry(
  model: string,
  reasoningEffort: TickerQaReasoningEffort,
  input: TickerQaOpenAiInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  repair: boolean,
  usage: UsageAccumulator,
): Promise<ProviderCallResult> {
  let maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callOpenAiOnce(model, reasoningEffort, input, apiKey, fetchImpl, maxOutputTokens, repair, usage)
    } catch (error) {
      if (!(error instanceof TickerQaIncompleteError)) throw error
      if (attempt > 0 || !error.inspection.shouldRetryWithMoreOutput) {
        throw new TickerQaProviderError("OpenAI Responses remained incomplete after bounded retry", true)
      }
      const nextBudget = nextMaxOutputTokensAfterIncomplete(maxOutputTokens)
      if (nextBudget === null || nextBudget <= maxOutputTokens) {
        throw new TickerQaProviderError("OpenAI Responses max-output retry budget is exhausted", true)
      }
      maxOutputTokens = nextBudget
    }
  }
  throw new TickerQaProviderError("OpenAI Responses exhausted bounded retry", true)
}

async function answerWithModel(
  model: string,
  route: TickerQaModelRoute,
  input: TickerQaOpenAiInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  usage: UsageAccumulator,
): Promise<{ output: TickerQaModelOutput; call: ProviderCallResult }> {
  const first = await callWithIncompleteRetry(model, route.reasoningEffort, input, apiKey, fetchImpl, false, usage)
  try {
    return { output: parseValidatedOutput(first.outputText, input.evidence), call: first }
  } catch (error) {
    if (!(error instanceof TickerQaValidationError)) throw error
  }

  const repaired = await callWithIncompleteRetry(model, route.reasoningEffort, input, apiKey, fetchImpl, true, usage)
  return { output: parseValidatedOutput(repaired.outputText, input.evidence), call: repaired }
}

export async function answerTickerQaWithOpenAi(
  input: TickerQaOpenAiInput,
  deps: TickerQaOpenAiDependencies = {},
): Promise<{ output: TickerQaModelOutput; audit: TickerQaProviderAudit; route: TickerQaModelRoute }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for ticker Q&A")

  const route = getTickerQaModelRoute()
  const fetchImpl = deps.fetchImpl ?? fetch
  const usage: UsageAccumulator = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  const attemptedModels: string[] = []
  const models = route.fallbackModel === route.model ? [route.model] : [route.model, route.fallbackModel]
  const startedAt = Date.now()
  let lastProviderError: TickerQaProviderError | null = null

  for (const [index, model] of models.entries()) {
    attemptedModels.push(model)
    try {
      const result = await answerWithModel(model, route, input, apiKey, fetchImpl, usage)
      return {
        output: result.output,
        route,
        audit: {
          promptVersion: TICKER_QA_PROMPT_VERSION,
          requestedModel: route.model,
          responseModel: result.call.inspection.responseModel || model,
          fallbackUsed: index > 0,
          attemptedModels,
          responseId: result.call.inspection.responseId || "",
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          latencyMs: Math.max(0, Date.now() - startedAt),
        },
      }
    } catch (error) {
      if (error instanceof TickerQaValidationError) throw error
      if (!(error instanceof TickerQaProviderError)) throw error
      lastProviderError = error
      if (!error.retryable || index === models.length - 1) throw error
    }
  }

  throw lastProviderError ?? new TickerQaProviderError("Ticker Q&A provider failed", true)
}
