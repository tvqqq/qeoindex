import type { SupabaseClient } from "@supabase/supabase-js"

import {
  buildTickerContext,
  type BuildTickerContextInput,
  type TickerContext,
} from "../ticker-knowledge/context.ts"
import {
  TickerKnowledgeUnavailableError,
  type TickerKnowledgeIndex,
  type TickerKnowledgeItem,
  type TickerKnowledgeUnavailableReason,
} from "../ticker-knowledge/domain.ts"
import {
  resolveTickerQaEvidence,
  type TickerQaCanonicalResolution,
  type TickerQaResolvedEvidence,
} from "./canonical.ts"
import {
  loadTickerQaMandatoryContext,
  type TickerQaMandatoryContext,
} from "./mandatory.ts"
import {
  answerTickerQaWithOpenAi,
  TickerQaValidationError,
  type TickerQaModelRoute,
  type TickerQaProviderAudit,
} from "./openai.ts"
import type { TickerQaModelOutput } from "./schema.ts"
import {
  TICKER_QA_LIMITS,
  type TickerQaAudit,
  type TickerQaCitation,
  type TickerQaRequest,
  type TickerQaResult,
  type TickerQaRetrievalStatus,
  type ValidatedTickerQaRequest,
} from "./types.ts"

const DEGRADED_RETRIEVAL_LIMITATION = "Semantic ticker knowledge retrieval is temporarily unavailable; answer uses available canonical context."
const PARTIAL_CANONICAL_LIMITATION = "Some canonical ticker sources are unavailable or missing for this request."

export type TickerQaErrorCode =
  | "invalid_request"
  | "feature_disabled"
  | "service_unavailable"
  | "provider_failed"
  | "invalid_model_output"

export class TickerQaError extends Error {
  readonly code: TickerQaErrorCode
  readonly httpStatus: number

  constructor(code: TickerQaErrorCode, httpStatus: number, message: string) {
    super(message)
    this.name = "TickerQaError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

type LoadMandatory = (
  client: SupabaseClient,
  ticker: string,
) => Promise<TickerQaMandatoryContext>

type BuildContext = (input: BuildTickerContextInput) => Promise<TickerContext>

type ResolveEvidence = (
  client: SupabaseClient,
  ticker: string,
  items: readonly TickerKnowledgeItem[],
) => Promise<TickerQaCanonicalResolution>

type AnswerWithAi = (input: {
  ticker: string
  question: string
  history: ValidatedTickerQaRequest["history"]
  evidence: readonly TickerQaResolvedEvidence[]
}) => Promise<{
  output: TickerQaModelOutput
  audit: TickerQaProviderAudit
  route: TickerQaModelRoute
}>

export interface TickerQaTelemetry {
  ticker: string
  retrievalStatus: TickerQaRetrievalStatus
  retrievalReason: TickerKnowledgeUnavailableReason | null
  infrastructureFailure: boolean
  contextTotalMs: number
  contextRetrievalMs: number
  contextRerankMs: number
  contextBuildMs: number
  hydrationMs: number
  selectedItemCount: number
  resolvedEvidenceCount: number
  unresolvedCount: number
  truncated: boolean
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  model: string
  fallbackUsed: boolean
  answerStatus: "answered" | "not_found" | "service_unavailable"
  totalMs: number
}

export interface TickerQaServiceDependencies {
  onValidatedRequest?: (request: ValidatedTickerQaRequest) => void | Promise<void>
  index?: TickerKnowledgeIndex
  loadMandatory?: LoadMandatory
  buildContext?: BuildContext
  resolveEvidence?: ResolveEvidence
  answerWithAi?: AnswerWithAi
  recordTelemetry?: (metric: TickerQaTelemetry) => void | Promise<void>
  execute?: (
    client: SupabaseClient,
    request: ValidatedTickerQaRequest,
  ) => Promise<TickerQaResult>
}

export interface PreparedTickerQaContext extends TickerQaCanonicalResolution {
  context: TickerContext
  limitations: string[]
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt)
}

export function validateTickerQaRequest(input: TickerQaRequest): ValidatedTickerQaRequest {
  const ticker = typeof input.ticker === "string" ? normalizeText(input.ticker).toUpperCase() : ""
  if (!/^[A-Z0-9]{2,12}$/.test(ticker)) {
    throw new TickerQaError("invalid_request", 400, "Invalid ticker")
  }

  const question = typeof input.question === "string" ? normalizeText(input.question) : ""
  if (!question || question.length > TICKER_QA_LIMITS.questionChars) {
    throw new TickerQaError("invalid_request", 400, "Invalid ticker Q&A question")
  }

  const history = input.history ?? []
  if (!Array.isArray(history) || history.length > TICKER_QA_LIMITS.historyTurns) {
    throw new TickerQaError("invalid_request", 400, "Invalid ticker Q&A history")
  }

  const normalizedHistory = history.map((turn) => {
    if (
      !turn
      || (turn.role !== "user" && turn.role !== "assistant")
      || typeof turn.content !== "string"
    ) {
      throw new TickerQaError("invalid_request", 400, "Invalid ticker Q&A history turn")
    }

    const content = normalizeText(turn.content)
    if (!content || content.length > TICKER_QA_LIMITS.historyTurnChars) {
      throw new TickerQaError("invalid_request", 400, "Invalid ticker Q&A history turn")
    }
    return { role: turn.role, content }
  })

  return { ticker, question, history: normalizedHistory }
}

function unavailableIndex(): TickerKnowledgeIndex {
  const unavailable = () => {
    throw new TickerKnowledgeUnavailableError("not_configured", "Ticker knowledge index is unavailable")
  }
  return {
    ensureReady: async () => unavailable(),
    upsert: async () => unavailable(),
    query: async () => unavailable(),
    deleteSourceVersion: async () => unavailable(),
  }
}

function postFilterContext(context: TickerContext, ticker: string): TickerContext {
  const items = context.items.filter((item) => item.ticker === ticker)
  const includedIds = new Set(items.map((item) => item.id))
  return {
    ...context,
    ticker,
    items,
    retrievedPointIds: context.retrievedPointIds.filter((id) => includedIds.has(id)),
    text: items.map((item) => item.text).join("\n\n"),
  }
}

export async function prepareTickerQaContext(
  client: SupabaseClient,
  request: ValidatedTickerQaRequest,
  deps: Pick<TickerQaServiceDependencies, "index" | "loadMandatory" | "buildContext" | "resolveEvidence"> = {},
): Promise<PreparedTickerQaContext> {
  const loadMandatory = deps.loadMandatory ?? ((db, ticker) => loadTickerQaMandatoryContext(db, ticker))
  const buildContext = deps.buildContext ?? buildTickerContext
  const resolveEvidence = deps.resolveEvidence ?? resolveTickerQaEvidence
  const mandatory = await loadMandatory(client, request.ticker)
  const context = await buildContext({
    index: deps.index ?? unavailableIndex(),
    ticker: request.ticker,
    query: request.question,
    consumer: "STOCK_QA",
    mandatory: mandatory.items,
  })
  const isolatedContext = postFilterContext(context, request.ticker)
  const resolved = await resolveEvidence(client, request.ticker, isolatedContext.items)

  return {
    ...resolved,
    infrastructureFailure: resolved.infrastructureFailure || Boolean(mandatory.infrastructureFailure),
    context: isolatedContext,
    limitations: mandatory.limitations,
  }
}

function projectedCitation(
  source: TickerQaResolvedEvidence,
  excerpt: string,
): TickerQaCitation | null {
  if (!source.citation) return null
  return { ...source.citation, excerpt }
}

export function projectTickerQaModelOutput(
  ticker: string,
  output: TickerQaModelOutput,
  evidence: readonly TickerQaResolvedEvidence[],
  options: {
    retrievalStatus: TickerQaRetrievalStatus
    limitation: string | null
    audit: TickerQaAudit | null
  },
): TickerQaResult {
  if (output.status === "not_found") {
    return {
      ticker,
      status: "not_found",
      answer: "",
      claims: [],
      citations: [],
      contradictions: [],
      retrievalStatus: options.retrievalStatus,
      limitation: options.limitation,
      audit: options.audit,
    }
  }

  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]))
  const citations: TickerQaCitation[] = []
  const citationKeys = new Set<string>()
  const claims = output.claims.flatMap((claim) => {
    const citationIds: string[] = []
    for (const modelCitation of claim.citations) {
      const source = evidenceById.get(modelCitation.evidenceId)
      if (!source) continue
      const citation = projectedCitation(source, modelCitation.excerpt)
      if (!citation) continue
      const key = `${citation.id}\u0000${citation.excerpt}`
      if (!citationKeys.has(key)) {
        citationKeys.add(key)
        citations.push(citation)
      }
      citationIds.push(citation.id)
    }
    if (!citationIds.length) return []
    return [{ text: claim.text, authority: claim.authority, citationIds: [...new Set(citationIds)] }]
  })

  if (!claims.length) {
    return {
      ticker,
      status: "not_found",
      answer: "",
      claims: [],
      citations: [],
      contradictions: [],
      retrievalStatus: options.retrievalStatus,
      limitation: options.limitation,
      audit: options.audit,
    }
  }

  return {
    ticker,
    status: "answered",
    answer: claims.map((claim) => claim.text).join("\n\n"),
    claims,
    citations,
    contradictions: output.contradictions.map((item) => ({ ...item })),
    retrievalStatus: options.retrievalStatus,
    limitation: options.limitation,
    audit: options.audit,
  }
}

function limitationFor(prepared: PreparedTickerQaContext) {
  if (prepared.context.retrievalStatus === "unavailable") return DEGRADED_RETRIEVAL_LIMITATION
  if (prepared.limitations.length || prepared.infrastructureFailure || prepared.unresolvedCount > 0) {
    return PARTIAL_CANONICAL_LIMITATION
  }
  return null
}

function auditFor(
  prepared: PreparedTickerQaContext,
  provider: TickerQaProviderAudit | null,
  totalMs: number,
): TickerQaAudit {
  return {
    retrievalStatus: prepared.context.retrievalStatus,
    contextTotalMs: prepared.context.telemetry.totalMs,
    contextRetrievalMs: prepared.context.telemetry.retrievalMs,
    contextRerankMs: prepared.context.telemetry.rerankMs,
    contextBuildMs: prepared.context.telemetry.buildMs,
    hydrationMs: prepared.hydrationMs,
    selectedItemCount: prepared.context.items.length,
    resolvedEvidenceCount: prepared.evidence.length,
    truncated: prepared.context.truncated,
    inputTokens: provider?.inputTokens ?? 0,
    cachedInputTokens: provider?.cachedInputTokens ?? 0,
    outputTokens: provider?.outputTokens ?? 0,
    reasoningTokens: provider?.reasoningTokens ?? 0,
    totalTokens: provider?.totalTokens ?? 0,
    model: provider?.responseModel ?? "",
    fallbackUsed: provider?.fallbackUsed ?? false,
    totalMs,
  }
}

function telemetryFor(
  ticker: string,
  prepared: PreparedTickerQaContext,
  audit: TickerQaAudit,
  answerStatus: TickerQaTelemetry["answerStatus"],
): TickerQaTelemetry {
  return {
    ticker,
    retrievalStatus: prepared.context.retrievalStatus,
    retrievalReason: prepared.context.retrievalReason,
    infrastructureFailure: prepared.infrastructureFailure,
    contextTotalMs: audit.contextTotalMs,
    contextRetrievalMs: audit.contextRetrievalMs,
    contextRerankMs: audit.contextRerankMs,
    contextBuildMs: audit.contextBuildMs,
    hydrationMs: audit.hydrationMs,
    selectedItemCount: audit.selectedItemCount,
    resolvedEvidenceCount: audit.resolvedEvidenceCount,
    unresolvedCount: prepared.unresolvedCount,
    truncated: audit.truncated,
    inputTokens: audit.inputTokens,
    cachedInputTokens: audit.cachedInputTokens,
    outputTokens: audit.outputTokens,
    reasoningTokens: audit.reasoningTokens,
    totalTokens: audit.totalTokens,
    model: audit.model,
    fallbackUsed: audit.fallbackUsed,
    answerStatus,
    totalMs: audit.totalMs,
  }
}

async function safeRecordTelemetry(
  recorder: TickerQaServiceDependencies["recordTelemetry"],
  metric: TickerQaTelemetry,
) {
  try {
    await recorder?.(metric)
  } catch {
    // Observability must never change the grounded answer/failure contract.
  }
}

function notFoundResult(
  ticker: string,
  prepared: PreparedTickerQaContext,
  audit: TickerQaAudit,
): TickerQaResult {
  return {
    ticker,
    status: "not_found",
    answer: "",
    claims: [],
    citations: [],
    contradictions: [],
    retrievalStatus: prepared.context.retrievalStatus,
    limitation: limitationFor(prepared),
    audit,
  }
}

export async function answerTickerQuestion(
  client: SupabaseClient,
  input: TickerQaRequest,
  deps: TickerQaServiceDependencies = {},
): Promise<TickerQaResult> {
  const request = validateTickerQaRequest(input)
  await deps.onValidatedRequest?.(request)
  if (deps.execute) return deps.execute(client, request)

  const startedAt = Date.now()
  let prepared: PreparedTickerQaContext
  try {
    prepared = await prepareTickerQaContext(client, request, deps)
  } catch {
    throw new TickerQaError("service_unavailable", 503, "Ticker Q&A canonical context is unavailable")
  }

  if (prepared.evidence.length === 0) {
    const audit = auditFor(prepared, null, elapsedMs(startedAt))
    if (prepared.context.retrievalStatus === "unavailable" || prepared.infrastructureFailure) {
      await safeRecordTelemetry(deps.recordTelemetry, telemetryFor(request.ticker, prepared, audit, "service_unavailable"))
      throw new TickerQaError("service_unavailable", 503, "Ticker Q&A evidence is temporarily unavailable")
    }
    const result = notFoundResult(request.ticker, prepared, audit)
    await safeRecordTelemetry(deps.recordTelemetry, telemetryFor(request.ticker, prepared, audit, "not_found"))
    return result
  }

  const answerWithAi = deps.answerWithAi ?? answerTickerQaWithOpenAi
  let providerResult: Awaited<ReturnType<AnswerWithAi>>
  try {
    providerResult = await answerWithAi({
      ticker: request.ticker,
      question: request.question,
      history: request.history,
      evidence: prepared.evidence,
    })
  } catch (error) {
    if (error instanceof TickerQaValidationError) {
      throw new TickerQaError("invalid_model_output", 502, "Ticker Q&A model output failed grounding validation")
    }
    throw new TickerQaError("provider_failed", 502, "Ticker Q&A provider is temporarily unavailable")
  }

  const audit = auditFor(prepared, providerResult.audit, elapsedMs(startedAt))
  const result = projectTickerQaModelOutput(
    request.ticker,
    providerResult.output,
    prepared.evidence,
    {
      retrievalStatus: prepared.context.retrievalStatus,
      limitation: limitationFor(prepared),
      audit,
    },
  )
  await safeRecordTelemetry(
    deps.recordTelemetry,
    telemetryFor(request.ticker, prepared, audit, result.status),
  )
  return result
}
