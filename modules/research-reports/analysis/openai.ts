import { createHash } from "node:crypto"

import {
  extractOpenAiOutputText,
  inspectOpenAiResponseEnvelope,
  nextMaxOutputTokensAfterIncomplete,
  OpenAiResponseError,
  type OpenAiResponseEnvelopeInspection,
} from "../../ai/openai-response.ts"
import type { ParsedReportPage, StructuredResearchReportAnalysis } from "../types.ts"
import {
  REPORT_PROMPT_VERSION,
  RESEARCH_REPORT_ANALYSIS_INSTRUCTIONS,
  buildResearchReportAnalysisInput,
} from "./prompt.ts"
import {
  RESEARCH_REPORT_ANALYSIS_JSON_SCHEMA,
  validateResearchReportAnalysis,
} from "./schema.ts"

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const DEFAULT_MODEL = "gpt-5.6-luna"
const DEFAULT_FALLBACK_MODEL = "gpt-5.6-terra"
const DEFAULT_REASONING_EFFORT: ReportReasoningEffort = "medium"
const INITIAL_MAX_OUTPUT_TOKENS = 2200
const REQUEST_TIMEOUT_MS = 30_000
const REPAIR_INSTRUCTION = "The previous structured result failed schema or citation-grounding validation. Re-read the exact same immutable document pages and return a corrected result. Do not add evidence, facts, targets, currencies, or page numbers that are not explicitly present in those pages."

export type ReportReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh"

export interface ReportAiModelRoute {
  model: string
  fallbackModel: string
  reasoningEffort: ReportReasoningEffort
  modelRouteKey: string
}

export interface ReportAiCallAudit {
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
  estimatedCostUsd: null
  pricingVersion: null
}

export interface ReportAiDependencies {
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

class ReportAiProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = "ReportAiProviderError"
  }
}

class ReportAiIncompleteError extends Error {
  constructor(readonly inspection: OpenAiResponseEnvelopeInspection) {
    super(`OpenAI response incomplete: ${inspection.incompleteReason ?? inspection.status ?? "unknown"}`)
    this.name = "ReportAiIncompleteError"
  }
}

class ReportAiValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReportAiValidationError"
  }
}

const ALLOWED_REASONING_EFFORTS = new Set<ReportReasoningEffort>([
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])

function envModel(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback
}

function reasoningEffortFromEnv(): ReportReasoningEffort {
  const configured = process.env.RESEARCH_REPORT_AI_REASONING_EFFORT?.trim().toLowerCase()
  if (configured && ALLOWED_REASONING_EFFORTS.has(configured as ReportReasoningEffort)) {
    return configured as ReportReasoningEffort
  }
  return DEFAULT_REASONING_EFFORT
}

export function getResearchReportAiModelRoute(): ReportAiModelRoute {
  const model = envModel("RESEARCH_REPORT_AI_MODEL", DEFAULT_MODEL)
  const fallbackModel = envModel("RESEARCH_REPORT_AI_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL)
  const reasoningEffort = reasoningEffortFromEnv()
  return {
    model,
    fallbackModel,
    reasoningEffort,
    modelRouteKey: `report-ai-v1:${model}:${fallbackModel}:${reasoningEffort}`,
  }
}

function promptCacheKey(pages: readonly ParsedReportPage[]) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ promptVersion: REPORT_PROMPT_VERSION, pages }))
    .digest("hex")
  return `research-report:${REPORT_PROMPT_VERSION}:${digest.slice(0, 32)}`
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

function parseValidatedAnalysis(outputText: string, pages: readonly ParsedReportPage[]) {
  let parsed: unknown
  try {
    parsed = JSON.parse(outputText)
  } catch {
    throw new ReportAiValidationError("Research report analysis validation failed: provider output was not valid JSON")
  }

  try {
    return validateResearchReportAnalysis(parsed, pages)
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid structured analysis"
    throw new ReportAiValidationError(`Research report analysis validation failed: ${message}`)
  }
}

async function callOpenAiOnce(
  model: string,
  reasoningEffort: ReportReasoningEffort,
  pages: readonly ParsedReportPage[],
  apiKey: string,
  fetchImpl: typeof fetch,
  maxOutputTokens: number,
  repair: boolean,
  usage: UsageAccumulator,
): Promise<ProviderCallResult> {
  const body = {
    model,
    instructions: repair
      ? `${RESEARCH_REPORT_ANALYSIS_INSTRUCTIONS}\n\n${REPAIR_INSTRUCTION}`
      : RESEARCH_REPORT_ANALYSIS_INSTRUCTIONS,
    input: buildResearchReportAnalysisInput(pages),
    reasoning: { effort: reasoningEffort },
    text: {
      format: {
        type: "json_schema",
        name: "research_report_analysis",
        strict: true,
        schema: RESEARCH_REPORT_ANALYSIS_JSON_SCHEMA,
      },
    },
    prompt_cache_key: promptCacheKey(pages),
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
    throw new ReportAiProviderError(`OpenAI Responses request failed: ${name}`, true)
  }

  const rawText = await response.text()
  let envelope: unknown
  try {
    envelope = rawText ? JSON.parse(rawText) : {}
  } catch {
    throw new ReportAiProviderError(
      `OpenAI Responses API ${response.status} returned an invalid response envelope`,
      response.status === 429 || response.status >= 500,
    )
  }

  if (!response.ok) {
    const providerMessage = safeProviderMessage(envelope)
    const suffix = providerMessage ? `: ${providerMessage}` : ""
    throw new ReportAiProviderError(
      `OpenAI Responses API ${response.status}${suffix}`,
      response.status === 429 || response.status >= 500,
    )
  }

  const inspection = inspectOpenAiResponseEnvelope(envelope)
  addUsage(usage, inspection)

  if (inspection.status === "incomplete") {
    throw new ReportAiIncompleteError(inspection)
  }
  if (inspection.status === "failed") {
    throw new ReportAiProviderError("OpenAI Responses provider returned failed status", true)
  }

  try {
    return {
      inspection,
      outputText: extractOpenAiOutputText(envelope),
    }
  } catch (error) {
    if (error instanceof OpenAiResponseError) {
      const retryable = !/refus/i.test(error.message)
      throw new ReportAiProviderError(`OpenAI Responses output failure: ${error.message}`, retryable)
    }
    throw error
  }
}

async function callWithIncompleteRetry(
  model: string,
  reasoningEffort: ReportReasoningEffort,
  pages: readonly ParsedReportPage[],
  apiKey: string,
  fetchImpl: typeof fetch,
  repair: boolean,
  usage: UsageAccumulator,
) {
  let maxOutputTokens = INITIAL_MAX_OUTPUT_TOKENS

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await callOpenAiOnce(
        model,
        reasoningEffort,
        pages,
        apiKey,
        fetchImpl,
        maxOutputTokens,
        repair,
        usage,
      )
    } catch (error) {
      if (!(error instanceof ReportAiIncompleteError)) throw error
      if (attempt > 0 || !error.inspection.shouldRetryWithMoreOutput) {
        throw new ReportAiProviderError("OpenAI Responses remained incomplete after bounded retry", true)
      }
      const nextBudget = nextMaxOutputTokensAfterIncomplete(maxOutputTokens, error.inspection)
      if (nextBudget <= maxOutputTokens) {
        throw new ReportAiProviderError("OpenAI Responses max-output retry budget is exhausted", true)
      }
      maxOutputTokens = nextBudget
    }
  }

  throw new ReportAiProviderError("OpenAI Responses exhausted bounded retry", true)
}

async function analyzeWithModel(
  model: string,
  route: ReportAiModelRoute,
  pages: readonly ParsedReportPage[],
  apiKey: string,
  fetchImpl: typeof fetch,
  usage: UsageAccumulator,
): Promise<{ analysis: StructuredResearchReportAnalysis; call: ProviderCallResult }> {
  const first = await callWithIncompleteRetry(
    model,
    route.reasoningEffort,
    pages,
    apiKey,
    fetchImpl,
    false,
    usage,
  )

  try {
    return { analysis: parseValidatedAnalysis(first.outputText, pages), call: first }
  } catch (error) {
    if (!(error instanceof ReportAiValidationError)) throw error
  }

  const repaired = await callWithIncompleteRetry(
    model,
    route.reasoningEffort,
    pages,
    apiKey,
    fetchImpl,
    true,
    usage,
  )
  return { analysis: parseValidatedAnalysis(repaired.outputText, pages), call: repaired }
}

export async function analyzeResearchReportPages(
  pages: readonly ParsedReportPage[],
  deps: ReportAiDependencies = {},
): Promise<{ analysis: StructuredResearchReportAnalysis; audit: ReportAiCallAudit; route: ReportAiModelRoute }> {
  if (pages.length === 0) throw new Error("Research report analysis requires at least one parsed page")

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for research report analysis")

  const route = getResearchReportAiModelRoute()
  const fetchImpl = deps.fetchImpl ?? fetch
  const attemptedModels: string[] = []
  const usage: UsageAccumulator = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  const startedAt = Date.now()
  const models = route.fallbackModel === route.model
    ? [route.model]
    : [route.model, route.fallbackModel]

  let finalResult: { analysis: StructuredResearchReportAnalysis; call: ProviderCallResult } | null = null
  let finalModel = route.model
  let lastProviderError: ReportAiProviderError | null = null

  for (const model of models) {
    attemptedModels.push(model)
    try {
      finalResult = await analyzeWithModel(model, route, pages, apiKey, fetchImpl, usage)
      finalModel = model
      break
    } catch (error) {
      if (error instanceof ReportAiValidationError) throw error
      if (!(error instanceof ReportAiProviderError)) throw error
      lastProviderError = error
      if (!error.retryable) throw error
    }
  }

  if (!finalResult) {
    throw lastProviderError ?? new ReportAiProviderError("OpenAI Responses analysis failed", false)
  }

  const inspection = finalResult.call.inspection
  return {
    analysis: finalResult.analysis,
    route,
    audit: {
      requestedModel: route.model,
      responseModel: inspection.responseModel || finalModel,
      fallbackUsed: finalModel !== route.model,
      attemptedModels,
      responseId: inspection.responseId || "",
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
}
