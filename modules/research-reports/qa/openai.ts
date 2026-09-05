import { createHash } from "node:crypto"

import {
  extractOpenAiOutputText,
  inspectOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete,
  OpenAiResponseError,
  type OpenAiResponseEnvelopeInspection,
} from "../../ai/openai-response.ts"
import {
  RESEARCH_REPORT_QA_INSTRUCTIONS,
  RESEARCH_REPORT_QA_PROMPT_VERSION,
  buildResearchReportQaInput,
} from "./prompt.ts"
import {
  RESEARCH_REPORT_QA_JSON_SCHEMA,
  validateResearchReportQaModelOutput,
  type ResearchReportQaModelOutput,
} from "./schema.ts"
import type {
  ResearchReportQaAudit,
  ResearchReportQaEvidence,
  ResearchReportQaTurn,
} from "./types.ts"

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const DEFAULT_MODEL = "gpt-5.6-luna"
const DEFAULT_FALLBACK_MODEL = "gpt-5.6-terra"
const DEFAULT_REASONING_EFFORT: ResearchReportQaReasoningEffort = "medium"
const INITIAL_MAX_OUTPUT_TOKENS = 1_600
const REQUEST_TIMEOUT_MS = 30_000
const REPAIR_INSTRUCTION = "The previous structured result failed schema or citation-grounding validation. Re-read the exact same immutable REPORT_EVIDENCE and return a corrected result. Do not add facts, figures, targets, recommendations, evidence IDs, excerpts, or outside knowledge that are not supported by that evidence."

export type ResearchReportQaReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

export interface ResearchReportQaModelRoute {
  model: string
  fallbackModel: string
  reasoningEffort: ResearchReportQaReasoningEffort
  modelRouteKey: string
}

export interface ResearchReportQaOpenAiInput {
  question: string
  history: readonly ResearchReportQaTurn[]
  evidence: readonly ResearchReportQaEvidence[]
}

export interface ResearchReportQaOpenAiDependencies {
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

class ResearchReportQaProviderError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = "ResearchReportQaProviderError"
    this.retryable = retryable
  }
}

class ResearchReportQaIncompleteError extends Error {
  readonly inspection: OpenAiResponseEnvelopeInspection

  constructor(inspection: OpenAiResponseEnvelopeInspection) {
    super(`OpenAI response incomplete: ${inspection.incompleteReason ?? inspection.status ?? "unknown"}`)
    this.name = "ResearchReportQaIncompleteError"
    this.inspection = inspection
  }
}

class ResearchReportQaValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ResearchReportQaValidationError"
  }
}

const ALLOWED_REASONING_EFFORTS = new Set<ResearchReportQaReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])

function envModel(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback
}

function reasoningEffortFromEnv(): ResearchReportQaReasoningEffort {
  const configured = process.env.RESEARCH_REPORT_QA_REASONING_EFFORT?.trim().toLowerCase()
  if (configured && ALLOWED_REASONING_EFFORTS.has(configured as ResearchReportQaReasoningEffort)) {
    return configured as ResearchReportQaReasoningEffort
  }
  return DEFAULT_REASONING_EFFORT
}

export function getResearchReportQaModelRoute(): ResearchReportQaModelRoute {
  const model = envModel("RESEARCH_REPORT_QA_MODEL", DEFAULT_MODEL)
  const fallbackModel = envModel("RESEARCH_REPORT_QA_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL)
  const reasoningEffort = reasoningEffortFromEnv()
  return {
    model,
    fallbackModel,
    reasoningEffort,
    modelRouteKey: `report-qa-v1:${model}:${fallbackModel}:${reasoningEffort}`,
  }
}

function promptCacheKey(input: ResearchReportQaOpenAiInput) {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      promptVersion: RESEARCH_REPORT_QA_PROMPT_VERSION,
      question: input.question,
      history: input.history,
      evidence: input.evidence.map((row) => ({
        evidenceId: row.evidenceId,
        chunkId: row.chunkId,
        contentHash: row.contentHash,
        chunkVersion: row.chunkVersion,
        page: row.page,
        chunkIndex: row.chunkIndex,
        content: row.content,
      })),
    }))
    .digest("hex")
  return `research-report-qa:${RESEARCH_REPORT_QA_PROMPT_VERSION}:${digest.slice(0, 32)}`
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
  evidence: readonly ResearchReportQaEvidence[],
): ResearchReportQaModelOutput {
  let parsed: unknown
  try {
    parsed = JSON.parse(outputText)
  } catch {
    throw new ResearchReportQaValidationError("Research report Q&A validation failed: provider output was not valid JSON")
  }

  try {
    return validateResearchReportQaModelOutput(parsed, evidence)
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid grounded Q&A output"
    throw new ResearchReportQaValidationError(`Research report Q&A validation failed: ${message}`)
  }
}

async function callOpenAiOnce(
  model: string,
  reasoningEffort: ResearchReportQaReasoningEffort,
  input: ResearchReportQaOpenAiInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  maxOutputTokens: number,
  repair: boolean,
  usage: UsageAccumulator,
): Promise<ProviderCallResult> {
  const body = {
    model,
    instructions: repair
      ? `${RESEARCH_REPORT_QA_INSTRUCTIONS}\n\n${REPAIR_INSTRUCTION}`
      : RESEARCH_REPORT_QA_INSTRUCTIONS,
    input: buildResearchReportQaInput(input),
    reasoning: { effort: reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "research_report_qa",
        strict: true,
        schema: RESEARCH_REPORT_QA_JSON_SCHEMA,
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
    throw new ResearchReportQaProviderError(`OpenAI Responses request failed: ${name}`, true)
  }

  const rawText = await response.text()
  let envelope: unknown
  try {
    envelope = rawText ? JSON.parse(rawText) : {}
  } catch {
    throw new ResearchReportQaProviderError(
      `OpenAI Responses API ${response.status} returned an invalid response envelope`,
      response.status === 429 || response.status >= 500,
    )
  }

  if (!response.ok) {
    const providerMessage = safeProviderMessage(envelope)
    const suffix = providerMessage ? `: ${providerMessage}` : ""
    throw new ResearchReportQaProviderError(
      `OpenAI Responses API ${response.status}${suffix}`,
      response.status === 429 || response.status >= 500,
    )
  }

  const inspection = inspectOpenAiResponseEnvelope(envelope)
  addUsage(usage, inspection)

  if (inspection.status === "incomplete") {
    throw new ResearchReportQaIncompleteError(inspection)
  }
  if (inspection.status === "failed") {
    throw new ResearchReportQaProviderError("OpenAI Responses provider returned failed status", true)
  }

  try {
    return {
      inspection,
      outputText: extractOpenAiOutputText(envelope),
    }
  } catch (error) {
    if (error instanceof OpenAiResponseError) {
      const retryable = !/refus/i.test(error.message)
      throw new ResearchReportQaProviderError(`OpenAI Responses output failure: ${error.message}`, retryable)
    }
    throw error
  }
}

async function callWithIncompleteRetry(
  model: string,
  reasoningEffort: ResearchReportQaReasoningEffort,
  input: ResearchReportQaOpenAiInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  repair: boolean,
  usage: UsageAccumulator,
): Promise<ProviderCallResult> {
  let maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callOpenAiOnce(
        model,
        reasoningEffort,
        input,
        apiKey,
        fetchImpl,
        maxOutputTokens,
        repair,
        usage,
      )
    } catch (error) {
      if (!(error instanceof ResearchReportQaIncompleteError)) throw error
      if (attempt > 0 || !error.inspection.shouldRetryWithMoreOutput) {
        throw new ResearchReportQaProviderError("OpenAI Responses remained incomplete after bounded retry", true)
      }
      const nextBudget = nextMaxOutputTokensAfterIncomplete(maxOutputTokens)
      if (nextBudget === null || nextBudget <= maxOutputTokens) {
        throw new ResearchReportQaProviderError("OpenAI Responses max-output retry budget is exhausted", true)
      }
      maxOutputTokens = nextBudget
    }
  }

  throw new ResearchReportQaProviderError("OpenAI Responses exhausted bounded retry", true)
}

async function answerWithModel(
  model: string,
  route: ResearchReportQaModelRoute,
  input: ResearchReportQaOpenAiInput,
  apiKey: string,
  fetchImpl: typeof fetch,
  usage: UsageAccumulator,
): Promise<{ output: ResearchReportQaModelOutput; call: ProviderCallResult }> {
  const first = await callWithIncompleteRetry(
    model,
    route.reasoningEffort,
    input,
    apiKey,
    fetchImpl,
    false,
    usage,
  )

  try {
    return {
      output: parseValidatedOutput(first.outputText, input.evidence),
      call: first,
    }
  } catch (error) {
    if (!(error instanceof ResearchReportQaValidationError)) throw error
  }

  const repaired = await callWithIncompleteRetry(
    model,
    route.reasoningEffort,
    input,
    apiKey,
    fetchImpl,
    true,
    usage,
  )
  return {
    output: parseValidatedOutput(repaired.outputText, input.evidence),
    call: repaired,
  }
}

export async function answerResearchReportQaWithOpenAi(
  input: ResearchReportQaOpenAiInput,
  deps: ResearchReportQaOpenAiDependencies = {},
): Promise<{
  output: ResearchReportQaModelOutput
  audit: ResearchReportQaAudit
  route: ResearchReportQaModelRoute
}> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for research report Q&A")

  const route = getResearchReportQaModelRoute()
  const fetchImpl = deps.fetchImpl ?? fetch
  const usage: UsageAccumulator = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  const attemptedModels: string[] = []
  const models = route.fallbackModel === route.model
    ? [route.model]
    : [route.model, route.fallbackModel]
  const startedAt = Date.now()

  let lastProviderError: ResearchReportQaProviderError | null = null

  for (const [index, model] of models.entries()) {
    attemptedModels.push(model)
    try {
      const result = await answerWithModel(model, route, input, apiKey, fetchImpl, usage)
      const responseModel = result.call.inspection.responseModel || model
      return {
        output: result.output,
        route,
        audit: {
          promptVersion: RESEARCH_REPORT_QA_PROMPT_VERSION,
          requestedModel: route.model,
          responseModel,
          fallbackUsed: index > 0,
          attemptedModels,
          responseId: result.call.inspection.responseId || "",
          inputTokens: usage.inputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          totalTokens: usage.totalTokens,
          latencyMs: Math.max(0, Date.now() - startedAt),
          estimatedCostUsd: null,
          pricingVersion: null,
        },
      }
    } catch (error) {
      if (error instanceof ResearchReportQaValidationError) throw error
      if (!(error instanceof ResearchReportQaProviderError)) throw error
      lastProviderError = error
      if (!error.retryable || index === models.length - 1) throw error
    }
  }

  throw lastProviderError ?? new ResearchReportQaProviderError("Research report Q&A provider failed", true)
}
