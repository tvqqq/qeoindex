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
} from "../ticker-knowledge/domain.ts"
import {
  resolveTickerQaEvidence,
  type TickerQaCanonicalResolution,
} from "./canonical.ts"
import {
  loadTickerQaMandatoryContext,
  type TickerQaMandatoryContext,
} from "./mandatory.ts"
import {
  TICKER_QA_LIMITS,
  type TickerQaRequest,
  type TickerQaResult,
  type ValidatedTickerQaRequest,
} from "./types.ts"

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

export interface TickerQaServiceDependencies {
  onValidatedRequest?: (request: ValidatedTickerQaRequest) => void | Promise<void>
  index?: TickerKnowledgeIndex
  loadMandatory?: LoadMandatory
  buildContext?: BuildContext
  resolveEvidence?: ResolveEvidence
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
    context: isolatedContext,
    limitations: mandatory.limitations,
  }
}

export async function answerTickerQuestion(
  client: SupabaseClient,
  input: TickerQaRequest,
  deps: TickerQaServiceDependencies = {},
): Promise<TickerQaResult> {
  const request = validateTickerQaRequest(input)
  await deps.onValidatedRequest?.(request)

  if (!deps.execute) {
    throw new TickerQaError("service_unavailable", 503, "Ticker Q&A service is unavailable")
  }

  return deps.execute(client, request)
}
