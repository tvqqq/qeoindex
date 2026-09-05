export const RESEARCH_REPORT_QA_LIMITS = {
  questionChars: 2_000,
  historyTurns: 6,
  historyTurnChars: 1_200,
  retrievalChunks: 8,
  evidenceChars: 16_000,
  citationExcerptChars: 240,
  claimChars: 1_200,
  claims: 8,
} as const

export type ResearchReportQaTurn = {
  role: "user" | "assistant"
  content: string
}

export interface ResearchReportQaEvidenceIdentity {
  reportId: string
  contentHash: string
  chunkVersion: string
  analysisId: string
}

export type ResearchReportQaEvidenceIdentityResolution =
  | { status: "ready"; identity: ResearchReportQaEvidenceIdentity }
  | { status: "not_found" }
  | { status: "not_ready" }

export interface ResearchReportQaEvidence {
  evidenceId: string
  chunkId: string
  reportId: string
  contentHash: string
  chunkVersion: string
  page: number
  chunkIndex: number
  content: string
  rank: number
}

export interface ResearchReportQaAudit {
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
  estimatedCostUsd: null
  pricingVersion: null
}

export interface ResearchReportQaSelectBuilder {
  select(columns: string): ResearchReportQaSelectBuilder
  eq(column: string, value: unknown): ResearchReportQaSelectBuilder
  order(column: string, options?: { ascending?: boolean }): ResearchReportQaSelectBuilder
  limit(value: number): ResearchReportQaSelectBuilder
  maybeSingle(): PromiseLike<{
    data: Record<string, unknown> | null
    error: { message?: string } | null
  }>
}

export interface ResearchReportQaRetrievalClient {
  from(table: string): ResearchReportQaSelectBuilder
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}
