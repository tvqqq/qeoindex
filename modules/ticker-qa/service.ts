import type { SupabaseClient } from "@supabase/supabase-js"

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

export interface TickerQaServiceDependencies {
  onValidatedRequest?: (request: ValidatedTickerQaRequest) => void | Promise<void>
  execute?: (
    client: SupabaseClient,
    request: ValidatedTickerQaRequest,
  ) => Promise<TickerQaResult>
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
