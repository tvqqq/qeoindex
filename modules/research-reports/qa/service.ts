import { answerResearchReportQaWithOpenAi } from "./openai.ts"
import {
  boundResearchReportQaEvidence,
  buildResearchReportQaLexicalQuery,
  resolveResearchReportQaEvidenceIdentity,
  retrieveResearchReportQaEvidence,
} from "./retrieval.ts"
import type { ResearchReportQaModelOutput } from "./schema.ts"
import {
  RESEARCH_REPORT_QA_LIMITS,
  type ResearchReportQaAudit,
  type ResearchReportQaEvidence,
  type ResearchReportQaEvidenceIdentity,
  type ResearchReportQaEvidenceIdentityResolution,
  type ResearchReportQaRetrievalClient,
  type ResearchReportQaTurn,
} from "./types.ts"

const NOT_FOUND_ANSWER = "Không tìm thấy thông tin này trong báo cáo."
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ResearchReportQaErrorCode =
  | "invalid_request"
  | "report_not_found"
  | "report_not_ready"
  | "retrieval_failed"
  | "provider_failed"
  | "invalid_model_output"

export type ResearchReportQaRetrievalMode = "lexical" | "shadow" | "hybrid"
export type ResearchReportQaRetrievalSelection = "lexical" | "hybrid"
export type ResearchReportQaHybridStatus = "ready" | "unavailable"

export interface ResearchReportQaRetrievalComparison {
  mode: Exclude<ResearchReportQaRetrievalMode, "lexical">
  selected: ResearchReportQaRetrievalSelection
  fallbackUsed: boolean
  lexicalCount: number
  lexicalMs: number
  hybridPointCount: number
  hybridCanonicalCount: number
  hybridCount: number
  hybridRetrievalMs: number
  hybridHydrationMs: number
  hybridResolutionRatio: number
  overlapCount: number
  overlapRatio: number
  hybridStatus: ResearchReportQaHybridStatus
}

export class ResearchReportQaError extends Error {
  readonly code: ResearchReportQaErrorCode
  readonly httpStatus: number

  constructor(code: ResearchReportQaErrorCode, httpStatus: number, message: string) {
    super(message)
    this.name = "ResearchReportQaError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface ResearchReportQaRequest {
  reportId: string
  question: string
  history?: readonly ResearchReportQaTurn[]
}

export interface ResearchReportQaCitation {
  page: number
  chunkId: string
  excerpt: string
}

export interface ResearchReportQaResult {
  reportId: string
  status: "answered" | "not_found"
  answer: string
  citations: ResearchReportQaCitation[]
  audit: ResearchReportQaAudit | null
}

type ResolveIdentity = (
  client: ResearchReportQaRetrievalClient,
  reportId: string,
) => Promise<ResearchReportQaEvidenceIdentityResolution>

type RetrieveEvidence = (
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  lexicalQuery: string,
) => Promise<ResearchReportQaEvidence[]>

type RetrieveHybridEvidence = (
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  lexicalQuery: string,
) => Promise<{
  status: ResearchReportQaHybridStatus
  evidence: readonly ResearchReportQaEvidence[]
  pointIds?: readonly string[]
  reason?: unknown
  retrievalMs?: number
  hydrationMs?: number
}>

type AnswerWithAi = (input: {
  question: string
  history: readonly ResearchReportQaTurn[]
  evidence: readonly ResearchReportQaEvidence[]
}) => Promise<{
  output: ResearchReportQaModelOutput
  audit: ResearchReportQaAudit
  route: unknown
}>

export interface ResearchReportQaServiceDependencies {
  resolveIdentity?: ResolveIdentity
  retrieveEvidence?: RetrieveEvidence
  retrieveHybridEvidence?: RetrieveHybridEvidence
  retrievalMode?: ResearchReportQaRetrievalMode
  recordRetrievalComparison?: (metric: ResearchReportQaRetrievalComparison) => void | Promise<void>
  answerWithAi?: AnswerWithAi
}

interface LexicalAttempt {
  evidence: ResearchReportQaEvidence[]
  elapsedMs: number
  error: unknown | null
}

interface HybridAttempt {
  status: ResearchReportQaHybridStatus
  evidence: ResearchReportQaEvidence[]
  pointCount: number
  canonicalCount: number
  retrievalMs: number
  hydrationMs: number
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function sanitizeErrorMessage(value: unknown) {
  const raw = value instanceof Error ? value.message : String(value ?? "unknown error")
  return raw
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9._-]+\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400)
}

function measuredMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt)
}

function metricMs(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function validateRequest(input: ResearchReportQaRequest): {
  reportId: string
  question: string
  history: ResearchReportQaTurn[]
} {
  const reportId = typeof input.reportId === "string" ? input.reportId.trim() : ""
  if (!reportId || !UUID_RE.test(reportId)) {
    throw new ResearchReportQaError("invalid_request", 400, "Invalid research report id")
  }

  const question = typeof input.question === "string" ? normalizeText(input.question) : ""
  if (!question || question.length > RESEARCH_REPORT_QA_LIMITS.questionChars) {
    throw new ResearchReportQaError("invalid_request", 400, "Invalid research report question")
  }

  const history = input.history ?? []
  if (!Array.isArray(history) || history.length > RESEARCH_REPORT_QA_LIMITS.historyTurns) {
    throw new ResearchReportQaError("invalid_request", 400, "Invalid research report Q&A history")
  }

  const normalizedHistory: ResearchReportQaTurn[] = history.map((turn) => {
    if (
      !turn
      || (turn.role !== "user" && turn.role !== "assistant")
      || typeof turn.content !== "string"
    ) {
      throw new ResearchReportQaError("invalid_request", 400, "Invalid research report Q&A history turn")
    }
    const content = normalizeText(turn.content)
    if (!content || content.length > RESEARCH_REPORT_QA_LIMITS.historyTurnChars) {
      throw new ResearchReportQaError("invalid_request", 400, "Invalid research report Q&A history turn")
    }
    return { role: turn.role, content }
  })

  return { reportId, question, history: normalizedHistory }
}

function notFoundResult(reportId: string, audit: ResearchReportQaAudit | null): ResearchReportQaResult {
  return {
    reportId,
    status: "not_found",
    answer: NOT_FOUND_ANSWER,
    citations: [],
    audit,
  }
}

function projectAnswer(
  reportId: string,
  output: ResearchReportQaModelOutput,
  evidence: readonly ResearchReportQaEvidence[],
  audit: ResearchReportQaAudit,
): ResearchReportQaResult {
  if (output.status === "not_found") return notFoundResult(reportId, audit)

  const evidenceById = new Map(evidence.map((row) => [row.evidenceId, row]))
  const citations: ResearchReportQaCitation[] = []
  const seen = new Set<string>()

  for (const claim of output.claims) {
    for (const citation of claim.citations) {
      const source = evidenceById.get(citation.evidenceId)
      if (!source) continue
      const key = `${source.chunkId}\u0000${citation.excerpt}`
      if (seen.has(key)) continue
      seen.add(key)
      citations.push({
        page: source.page,
        chunkId: source.chunkId,
        excerpt: citation.excerpt,
      })
    }
  }

  return {
    reportId,
    status: "answered",
    answer: output.claims.map((claim) => claim.text).join("\n\n"),
    citations,
    audit,
  }
}

async function retrieveLexicalAttempt(
  retrieveEvidence: RetrieveEvidence,
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  lexicalQuery: string,
): Promise<LexicalAttempt> {
  const startedAt = Date.now()
  try {
    return {
      evidence: boundResearchReportQaEvidence(await retrieveEvidence(client, identity, lexicalQuery)),
      elapsedMs: measuredMs(startedAt),
      error: null,
    }
  } catch (error) {
    return {
      evidence: [],
      elapsedMs: measuredMs(startedAt),
      error,
    }
  }
}

async function retrieveHybridAttempt(
  retrieveHybridEvidence: RetrieveHybridEvidence,
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  lexicalQuery: string,
): Promise<HybridAttempt> {
  try {
    const result = await retrieveHybridEvidence(client, identity, lexicalQuery)
    const canonical = result.status === "ready" ? [...result.evidence] : []
    return {
      status: result.status,
      evidence: result.status === "ready" ? boundResearchReportQaEvidence(canonical) : [],
      pointCount: result.pointIds?.length ?? 0,
      canonicalCount: canonical.length,
      retrievalMs: metricMs(result.retrievalMs),
      hydrationMs: metricMs(result.hydrationMs),
    }
  } catch {
    return {
      status: "unavailable",
      evidence: [],
      pointCount: 0,
      canonicalCount: 0,
      retrievalMs: 0,
      hydrationMs: 0,
    }
  }
}

function retrievalComparison(input: {
  mode: Exclude<ResearchReportQaRetrievalMode, "lexical">
  selected: ResearchReportQaRetrievalSelection
  fallbackUsed: boolean
  lexical: LexicalAttempt
  hybrid: HybridAttempt
}): ResearchReportQaRetrievalComparison {
  const lexicalIds = new Set(input.lexical.evidence.map((row) => row.chunkId))
  const hybridIds = new Set(input.hybrid.evidence.map((row) => row.chunkId))
  let overlapCount = 0
  for (const id of hybridIds) if (lexicalIds.has(id)) overlapCount += 1
  const denominator = Math.min(lexicalIds.size, hybridIds.size)
  const resolutionRatio = input.hybrid.pointCount > 0
    ? Math.min(1, input.hybrid.canonicalCount / input.hybrid.pointCount)
    : 0

  return {
    mode: input.mode,
    selected: input.selected,
    fallbackUsed: input.fallbackUsed,
    lexicalCount: input.lexical.evidence.length,
    lexicalMs: input.lexical.elapsedMs,
    hybridPointCount: input.hybrid.pointCount,
    hybridCanonicalCount: input.hybrid.canonicalCount,
    hybridCount: input.hybrid.evidence.length,
    hybridRetrievalMs: input.hybrid.retrievalMs,
    hybridHydrationMs: input.hybrid.hydrationMs,
    hybridResolutionRatio: resolutionRatio,
    overlapCount,
    overlapRatio: denominator > 0 ? overlapCount / denominator : 0,
    hybridStatus: input.hybrid.status,
  }
}

async function recordComparisonSafely(
  recorder: ResearchReportQaServiceDependencies["recordRetrievalComparison"],
  metric: ResearchReportQaRetrievalComparison,
) {
  if (!recorder) return
  try {
    await recorder(metric)
  } catch {
    // Observability must never become a user-visible Q&A dependency.
  }
}

function throwRetrievalFailure(error: unknown): never {
  throw new ResearchReportQaError(
    "retrieval_failed",
    502,
    sanitizeErrorMessage(error),
  )
}

export async function answerResearchReportQuestion(
  client: ResearchReportQaRetrievalClient,
  input: ResearchReportQaRequest,
  deps: ResearchReportQaServiceDependencies = {},
): Promise<ResearchReportQaResult> {
  const request = validateRequest(input)
  const resolveIdentity = deps.resolveIdentity ?? resolveResearchReportQaEvidenceIdentity
  const retrieveEvidence = deps.retrieveEvidence ?? retrieveResearchReportQaEvidence
  const retrieveHybridEvidence = deps.retrieveHybridEvidence
  const retrievalMode = deps.retrievalMode ?? "lexical"
  const answerWithAi = deps.answerWithAi ?? answerResearchReportQaWithOpenAi

  let resolution: ResearchReportQaEvidenceIdentityResolution
  try {
    resolution = await resolveIdentity(client, request.reportId)
  } catch (error) {
    throwRetrievalFailure(error)
  }

  if (resolution.status === "not_found") {
    throw new ResearchReportQaError("report_not_found", 404, "Research report not found")
  }
  if (resolution.status === "not_ready") {
    throw new ResearchReportQaError("report_not_ready", 409, "Research report analysis is not ready")
  }

  const lexicalQuery = buildResearchReportQaLexicalQuery(request.question, request.history)
  let evidence: ResearchReportQaEvidence[] = []

  if (retrievalMode === "lexical" || !retrieveHybridEvidence) {
    const lexical = await retrieveLexicalAttempt(
      retrieveEvidence,
      client,
      resolution.identity,
      lexicalQuery,
    )
    if (lexical.error) throwRetrievalFailure(lexical.error)
    evidence = lexical.evidence
  } else if (retrievalMode === "shadow") {
    const lexical = await retrieveLexicalAttempt(
      retrieveEvidence,
      client,
      resolution.identity,
      lexicalQuery,
    )
    if (lexical.error) throwRetrievalFailure(lexical.error)

    const hybrid = await retrieveHybridAttempt(
      retrieveHybridEvidence,
      client,
      resolution.identity,
      lexicalQuery,
    )

    evidence = lexical.evidence
    await recordComparisonSafely(deps.recordRetrievalComparison, retrievalComparison({
      mode: "shadow",
      selected: "lexical",
      fallbackUsed: false,
      lexical,
      hybrid,
    }))
  } else {
    const hybrid = await retrieveHybridAttempt(
      retrieveHybridEvidence,
      client,
      resolution.identity,
      lexicalQuery,
    )
    const lexical = await retrieveLexicalAttempt(
      retrieveEvidence,
      client,
      resolution.identity,
      lexicalQuery,
    )

    const useHybrid = hybrid.status === "ready" && hybrid.evidence.length > 0
    if (useHybrid) {
      evidence = hybrid.evidence
      await recordComparisonSafely(deps.recordRetrievalComparison, retrievalComparison({
        mode: "hybrid",
        selected: "hybrid",
        fallbackUsed: false,
        lexical,
        hybrid,
      }))
    } else {
      if (lexical.error) throwRetrievalFailure(lexical.error)
      evidence = lexical.evidence
      await recordComparisonSafely(deps.recordRetrievalComparison, retrievalComparison({
        mode: "hybrid",
        selected: "lexical",
        fallbackUsed: true,
        lexical,
        hybrid,
      }))
    }
  }

  if (evidence.length === 0) return notFoundResult(request.reportId, null)

  try {
    const result = await answerWithAi({
      question: request.question,
      history: request.history,
      evidence,
    })
    return projectAnswer(request.reportId, result.output, evidence, result.audit)
  } catch (error) {
    const code: ResearchReportQaErrorCode = error instanceof Error
      && error.name === "ResearchReportQaValidationError"
      ? "invalid_model_output"
      : "provider_failed"
    throw new ResearchReportQaError(
      code,
      502,
      sanitizeErrorMessage(error),
    )
  }
}
