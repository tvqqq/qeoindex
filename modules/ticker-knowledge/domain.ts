import { createHash } from "node:crypto"

export const TICKER_KNOWLEDGE_SCHEMA_VERSION = "ticker-knowledge-v1" as const
export const TICKER_KNOWLEDGE_PROJECTION_VERSION = "ticker-knowledge-projection-v1" as const
export const TICKER_KNOWLEDGE_COLLECTION = "ticker_knowledge" as const

export const TICKER_KNOWLEDGE_TYPES = [
  "REPORT_CHUNK",
  "REPORT_SUMMARY",
  "BROKER_VIEW",
  "FUNDAMENTAL_FACT",
  "COMPANY_EVENT",
  "COUNCIL_MEMORY",
  "COUNCIL_SCENARIO",
  "COUNCIL_OUTCOME",
  "COUNCIL_ERROR",
  "LESSON",
  "MARKET_CONTEXT",
] as const

export const TICKER_KNOWLEDGE_AUTHORITIES = [
  "VERIFIED_FACT",
  "DETERMINISTIC_SIGNAL",
  "SOURCE_OPINION",
  "AI_INFERENCE",
  "HISTORICAL_LESSON",
] as const

export const TICKER_KNOWLEDGE_SOURCE_TYPES = [
  "RESEARCH_REPORT",
  "AI_COUNCIL",
  "COMPANY_FILING",
  "MARKET_DATA",
  "NEWS",
  "MANUAL_RESEARCH",
  "OTHER",
] as const

export type TickerKnowledgeType = typeof TICKER_KNOWLEDGE_TYPES[number]
export type TickerKnowledgeAuthority = typeof TICKER_KNOWLEDGE_AUTHORITIES[number]
export type TickerKnowledgeSourceType = typeof TICKER_KNOWLEDGE_SOURCE_TYPES[number]

export interface TickerKnowledgeIdentityInput {
  ticker: string
  knowledgeType: TickerKnowledgeType
  sourceType: TickerKnowledgeSourceType
  sourceId: string
  logicalKey: string
}

export interface TickerKnowledgeIdentity {
  id: string
  identityKey: string
  ticker: string
  schemaVersion: typeof TICKER_KNOWLEDGE_SCHEMA_VERSION
}

export interface TickerKnowledgeProvenance {
  sourceId: string
  sourceVersion: string
  contentHash?: string | null
  reportId?: string | null
  analysisId?: string | null
  chunkVersion?: string | null
  runId?: string | null
  page?: number | null
  chunkId?: string | null
  chunkIndex?: number | null
  publishedAt?: string | null
  asOf?: string | null
  storagePath?: string | null
}

export interface TickerKnowledgeItem {
  id: string
  identityKey: string
  ticker: string
  knowledgeType: TickerKnowledgeType
  authority: TickerKnowledgeAuthority
  sourceType: TickerKnowledgeSourceType
  text: string
  provenance: TickerKnowledgeProvenance
  schemaVersion: typeof TICKER_KNOWLEDGE_SCHEMA_VERSION
  projectionVersion: string
  indexedAt?: string | null
}

export interface TickerKnowledgeDerivedVersions {
  embeddingModel: string
  embeddingVersion: string
  sparseEncoder: string
  sparseVersion: string
}

export interface TickerKnowledgeQuery {
  ticker: string
  text: string
  knowledgeTypes?: readonly TickerKnowledgeType[]
  sourceTypes?: readonly TickerKnowledgeSourceType[]
  authorities?: readonly TickerKnowledgeAuthority[]
  reportId?: string
  analysisId?: string
  runId?: string
  sourceId?: string
  sourceVersion?: string
  contentHash?: string
  chunkVersion?: string
  publishedFrom?: string
  publishedTo?: string
  asOf?: string
  limit?: number
}

export interface TickerKnowledgeSearchResult {
  id: string
  score: number
  item: TickerKnowledgeItem
  derivedVersions: TickerKnowledgeDerivedVersions
}

export interface TickerKnowledgeIndex {
  ensureReady(): Promise<void>
  upsert(items: readonly TickerKnowledgeItem[]): Promise<void>
  query(input: TickerKnowledgeQuery): Promise<TickerKnowledgeSearchResult[]>
  deleteSourceVersion(input: {
    ticker: string
    sourceType: TickerKnowledgeSourceType
    sourceId: string
    sourceVersion: string
  }): Promise<void>
}

export interface TickerKnowledgeEmbeddingProvider {
  readonly model: string
  readonly version: string
  readonly dimensions: number
  embed(texts: readonly string[]): Promise<number[][]>
}

export type TickerKnowledgeUnavailableReason =
  | "not_configured"
  | "embedding_unavailable"
  | "qdrant_unavailable"
  | "qdrant_timeout"
  | "invalid_response"

export class TickerKnowledgeUnavailableError extends Error {
  readonly reason: TickerKnowledgeUnavailableReason

  constructor(reason: TickerKnowledgeUnavailableReason, message: string) {
    super(message)
    this.name = "TickerKnowledgeUnavailableError"
    this.reason = reason
  }
}

export type SafeTickerKnowledgeQueryResult =
  | { status: "ready"; results: TickerKnowledgeSearchResult[] }
  | { status: "unavailable"; results: []; reason: TickerKnowledgeUnavailableReason }

function normalizeRequired(value: string, label: string) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

export function normalizeTicker(value: string) {
  const ticker = normalizeRequired(value, "ticker").toUpperCase()
  if (!/^[A-Z0-9._-]{1,24}$/.test(ticker)) throw new Error("Invalid ticker")
  return ticker
}

function uuidV5LikeFromSha256(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("")
  hex[12] = "5"
  const variant = Number.parseInt(hex[16], 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)
  const compact = hex.join("")
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
}

export function createTickerKnowledgeIdentity(input: TickerKnowledgeIdentityInput): TickerKnowledgeIdentity {
  const ticker = normalizeTicker(input.ticker)
  const sourceId = normalizeRequired(input.sourceId, "sourceId")
  const logicalKey = normalizeRequired(input.logicalKey, "logicalKey")
  const identityKey = [
    TICKER_KNOWLEDGE_SCHEMA_VERSION,
    ticker,
    input.knowledgeType,
    input.sourceType,
    sourceId,
    logicalKey,
  ].join("|")
  return {
    id: uuidV5LikeFromSha256(identityKey),
    identityKey,
    ticker,
    schemaVersion: TICKER_KNOWLEDGE_SCHEMA_VERSION,
  }
}

export function createTickerKnowledgeItem(input: Omit<TickerKnowledgeItem, "id" | "identityKey" | "ticker" | "schemaVersion"> & {
  ticker: string
  logicalKey: string
}): TickerKnowledgeItem {
  const identity = createTickerKnowledgeIdentity({
    ticker: input.ticker,
    knowledgeType: input.knowledgeType,
    sourceType: input.sourceType,
    sourceId: input.provenance.sourceId,
    logicalKey: input.logicalKey,
  })
  const text = normalizeRequired(input.text, "text")
  const sourceVersion = normalizeRequired(input.provenance.sourceVersion, "sourceVersion")
  return {
    id: identity.id,
    identityKey: identity.identityKey,
    ticker: identity.ticker,
    knowledgeType: input.knowledgeType,
    authority: input.authority,
    sourceType: input.sourceType,
    text,
    provenance: { ...input.provenance, sourceId: input.provenance.sourceId.trim(), sourceVersion },
    schemaVersion: TICKER_KNOWLEDGE_SCHEMA_VERSION,
    projectionVersion: normalizeRequired(input.projectionVersion, "projectionVersion"),
    indexedAt: input.indexedAt ?? null,
  }
}

export async function queryTickerKnowledgeSafely(
  index: TickerKnowledgeIndex,
  input: TickerKnowledgeQuery,
): Promise<SafeTickerKnowledgeQueryResult> {
  try {
    await index.ensureReady()
    return { status: "ready", results: await index.query(input) }
  } catch (error) {
    if (error instanceof TickerKnowledgeUnavailableError) {
      return { status: "unavailable", results: [], reason: error.reason }
    }
    throw error
  }
}
