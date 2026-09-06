import type { TickerKnowledgeAuthority } from "../ticker-knowledge/domain.ts"

export const TICKER_QA_LIMITS = {
  questionChars: 2_000,
  historyTurns: 6,
  historyTurnChars: 1_200,
  evidenceChars: 18_000,
  retrievalItems: 12,
  citationExcerptChars: 240,
  claims: 8,
} as const

export type TickerQaTurn = {
  role: "user" | "assistant"
  content: string
}

export type TickerQaRetrievalStatus = "ready" | "unavailable"

export type TickerQaSourceType = "NOTION_THESIS" | "RESEARCH_REPORT" | "AI_COUNCIL"

export interface TickerQaCitation {
  id: string
  sourceType: TickerQaSourceType
  authority: TickerKnowledgeAuthority
  label: string
  excerpt: string
  href: string | null
  reportId?: string
  page?: number
  runId?: string
  sourceVersion?: string
}

export interface TickerQaContradiction {
  leftEvidenceId: string
  rightEvidenceId: string
  explanation: string
}

export interface TickerQaAudit {
  retrievalStatus: TickerQaRetrievalStatus
  contextTotalMs: number
  contextRetrievalMs: number
  contextRerankMs: number
  contextBuildMs: number
  hydrationMs: number
  selectedItemCount: number
  resolvedEvidenceCount: number
  truncated: boolean
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  model: string
  fallbackUsed: boolean
  totalMs: number
}

export interface TickerQaRequest {
  ticker: string
  question: string
  history?: readonly TickerQaTurn[]
}

export interface ValidatedTickerQaRequest {
  ticker: string
  question: string
  history: TickerQaTurn[]
}

export interface TickerQaResult {
  ticker: string
  status: "answered" | "not_found"
  answer: string
  citations: TickerQaCitation[]
  contradictions: TickerQaContradiction[]
  retrievalStatus: TickerQaRetrievalStatus
  limitation: string | null
  audit: TickerQaAudit | null
}
