import {
  RESEARCH_REPORT_QA_LIMITS,
  type ResearchReportQaEvidence,
  type ResearchReportQaEvidenceIdentity,
  type ResearchReportQaEvidenceIdentityResolution,
  type ResearchReportQaRetrievalClient,
  type ResearchReportQaTurn,
} from "./types.ts"

const REPORT_TABLE = "market_research_reports"
const ANALYSIS_TABLE = "market_research_report_analyses"
const SEARCH_RPC = "qeo_search_research_report_chunks"
const HYDRATE_RPC = "qeo_hydrate_research_report_chunks"
const HASH_RE = /^[0-9a-f]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function safeErrorMessage(value: string | null | undefined) {
  return normalizeText(value ?? "unknown Supabase error").slice(0, 300)
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized || null
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function makeEvidenceId(row: { id: string; contentHash: string; chunkVersion: string }) {
  return `rr:${row.contentHash.slice(0, 12)}:${row.chunkVersion}:${row.id}`
}

export async function resolveResearchReportQaEvidenceIdentity(
  client: ResearchReportQaRetrievalClient,
  reportId: string,
): Promise<ResearchReportQaEvidenceIdentityResolution> {
  const reportResult = await client
    .from(REPORT_TABLE)
    .select("id,content_hash,analysis_status")
    .eq("id", reportId)
    .maybeSingle()

  if (reportResult.error) {
    throw new Error(`Research report Q&A report lookup failed: ${safeErrorMessage(reportResult.error.message)}`)
  }
  if (!reportResult.data) return { status: "not_found" }

  const contentHash = asNonEmptyString(reportResult.data.content_hash)
  if (reportResult.data.analysis_status !== "ready" || !contentHash || !HASH_RE.test(contentHash)) {
    return { status: "not_ready" }
  }

  const analysisResult = await client
    .from(ANALYSIS_TABLE)
    .select("id,report_id,content_hash,chunk_version,processed_at,created_at")
    .eq("report_id", reportId)
    .eq("content_hash", contentHash)
    .order("processed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (analysisResult.error) {
    throw new Error(`Research report Q&A analysis lookup failed: ${safeErrorMessage(analysisResult.error.message)}`)
  }
  if (!analysisResult.data) return { status: "not_ready" }

  const analysisId = asNonEmptyString(analysisResult.data.id)
  const analysisReportId = asNonEmptyString(analysisResult.data.report_id)
  const analysisHash = asNonEmptyString(analysisResult.data.content_hash)
  const chunkVersion = asNonEmptyString(analysisResult.data.chunk_version)
  if (
    !analysisId
    || analysisReportId !== reportId
    || analysisHash !== contentHash
    || !chunkVersion
  ) {
    return { status: "not_ready" }
  }

  return {
    status: "ready",
    identity: {
      reportId,
      contentHash,
      chunkVersion,
      analysisId,
    },
  }
}

export function buildResearchReportQaLexicalQuery(
  question: string,
  history: readonly ResearchReportQaTurn[],
): string {
  const recentUserTurns = history
    .filter((turn) => turn.role === "user")
    .slice(-3)
    .map((turn) => normalizeText(turn.content))
    .filter(Boolean)

  return normalizeText([...recentUserTurns, normalizeText(question)].join(" ")).slice(0, 4_000)
}

function parseEvidenceRow(
  value: unknown,
  identity: ResearchReportQaEvidenceIdentity,
): ResearchReportQaEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = asNonEmptyString(row.id)
  const reportId = asNonEmptyString(row.report_id)
  const contentHash = asNonEmptyString(row.content_hash)
  const chunkVersion = asNonEmptyString(row.chunk_version)
  const page = asInteger(row.page_number)
  const chunkIndex = asInteger(row.chunk_index)
  const content = typeof row.content === "string" ? row.content : null
  const rank = asFiniteNumber(row.rank)

  if (
    !id
    || reportId !== identity.reportId
    || contentHash !== identity.contentHash
    || chunkVersion !== identity.chunkVersion
    || page === null
    || page < 1
    || chunkIndex === null
    || chunkIndex < 0
    || content === null
    || rank === null
  ) {
    return null
  }

  return {
    evidenceId: makeEvidenceId({ id, contentHash, chunkVersion }),
    chunkId: id,
    reportId,
    contentHash,
    chunkVersion,
    page,
    chunkIndex,
    content,
    rank,
  }
}

export async function retrieveResearchReportQaEvidence(
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  lexicalQuery: string,
): Promise<ResearchReportQaEvidence[]> {
  const query = normalizeText(lexicalQuery)
  if (!query) return []

  const result = await client.rpc(SEARCH_RPC, {
    p_report_id: identity.reportId,
    p_content_hash: identity.contentHash,
    p_chunk_version: identity.chunkVersion,
    p_query: query,
    p_limit: RESEARCH_REPORT_QA_LIMITS.retrievalChunks,
  })

  if (result.error) {
    throw new Error(`Research report Q&A retrieval failed: ${safeErrorMessage(result.error.message)}`)
  }
  if (!Array.isArray(result.data)) return []

  return result.data
    .map((row) => parseEvidenceRow(row, identity))
    .filter((row): row is ResearchReportQaEvidence => row !== null)
    .slice(0, RESEARCH_REPORT_QA_LIMITS.retrievalChunks)
}

export interface ResearchReportQaRankedChunkRef {
  chunkId: string
  rank: number
}

export async function hydrateResearchReportQaEvidence(
  client: ResearchReportQaRetrievalClient,
  identity: ResearchReportQaEvidenceIdentity,
  candidates: readonly ResearchReportQaRankedChunkRef[],
): Promise<ResearchReportQaEvidence[]> {
  const ranked: ResearchReportQaRankedChunkRef[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const chunkId = typeof candidate.chunkId === "string" ? candidate.chunkId.trim() : ""
    if (!UUID_RE.test(chunkId) || !Number.isFinite(candidate.rank) || seen.has(chunkId)) continue
    seen.add(chunkId)
    ranked.push({ chunkId, rank: candidate.rank })
    if (ranked.length >= RESEARCH_REPORT_QA_LIMITS.retrievalChunks) break
  }
  if (ranked.length === 0) return []

  const result = await client.rpc(HYDRATE_RPC, {
    p_report_id: identity.reportId,
    p_content_hash: identity.contentHash,
    p_chunk_version: identity.chunkVersion,
    p_chunk_ids: ranked.map((candidate) => candidate.chunkId),
  })

  if (result.error) {
    throw new Error(`Research report Q&A hydration failed: ${safeErrorMessage(result.error.message)}`)
  }
  if (!Array.isArray(result.data)) return []

  const rankByChunkId = new Map(ranked.map((candidate) => [candidate.chunkId, candidate.rank]))
  const canonicalByChunkId = new Map<string, ResearchReportQaEvidence>()
  for (const value of result.data) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const rawId = asNonEmptyString((value as Record<string, unknown>).id)
    if (!rawId || !rankByChunkId.has(rawId)) continue
    const parsed = parseEvidenceRow(
      { ...(value as Record<string, unknown>), rank: rankByChunkId.get(rawId) },
      identity,
    )
    if (parsed) canonicalByChunkId.set(parsed.chunkId, parsed)
  }

  return ranked
    .map((candidate) => canonicalByChunkId.get(candidate.chunkId) ?? null)
    .filter((row): row is ResearchReportQaEvidence => row !== null)
}

export function boundResearchReportQaEvidence(
  evidence: readonly ResearchReportQaEvidence[],
): ResearchReportQaEvidence[] {
  const bounded: ResearchReportQaEvidence[] = []
  let chars = 0

  for (const row of evidence.slice(0, RESEARCH_REPORT_QA_LIMITS.retrievalChunks)) {
    if (chars + row.content.length > RESEARCH_REPORT_QA_LIMITS.evidenceChars) break
    bounded.push(row)
    chars += row.content.length
  }

  return bounded
}
