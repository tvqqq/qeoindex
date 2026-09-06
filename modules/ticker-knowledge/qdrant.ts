import {
  TICKER_KNOWLEDGE_COLLECTION,
  TICKER_KNOWLEDGE_SCHEMA_VERSION,
  TickerKnowledgeUnavailableError,
  normalizeTicker,
  type TickerKnowledgeAuthority,
  type TickerKnowledgeDerivedVersions,
  type TickerKnowledgeEmbeddingProvider,
  type TickerKnowledgeIndex,
  type TickerKnowledgeItem,
  type TickerKnowledgeQuery,
  type TickerKnowledgeSearchResult,
  type TickerKnowledgeSourceType,
  type TickerKnowledgeType,
} from "./domain.ts"
import {
  TICKER_KNOWLEDGE_SPARSE_ENCODER,
  TICKER_KNOWLEDGE_SPARSE_VERSION,
  encodeTickerKnowledgeSparse,
} from "./sparse.ts"

const DENSE_VECTOR_NAME = "dense"
const SPARSE_VECTOR_NAME = "lexical"
const DEFAULT_TIMEOUT_MS = 8_000
const MAX_QUERY_RESULTS = 24
const MAX_UPSERT_BATCH = 64

const PAYLOAD_INDEXES = [
  ["ticker", "keyword"],
  ["knowledge_type", "keyword"],
  ["source_type", "keyword"],
  ["authority", "keyword"],
  ["source_id", "keyword"],
  ["source_version", "keyword"],
  ["content_hash", "keyword"],
  ["report_id", "keyword"],
  ["analysis_id", "keyword"],
  ["run_id", "keyword"],
  ["published_at", "datetime"],
  ["as_of", "datetime"],
] as const

export interface QdrantTickerKnowledgeIndexOptions {
  baseUrl: string
  apiKey: string
  embeddingProvider: TickerKnowledgeEmbeddingProvider
  collectionName?: typeof TICKER_KNOWLEDGE_COLLECTION
  vectorSize?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

type QdrantJson = Record<string, unknown>

function normalizeBaseUrl(value: string) {
  const raw = value.trim().replace(/\/+$/, "")
  if (!raw) throw new TickerKnowledgeUnavailableError("not_configured", "QDRANT_URL is required")
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new TickerKnowledgeUnavailableError("not_configured", "QDRANT_URL is invalid")
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new TickerKnowledgeUnavailableError("not_configured", "QDRANT_URL must use HTTPS")
  }
  return raw
}

function normalizedLimit(value: number | undefined) {
  if (value === undefined) return 8
  if (!Number.isFinite(value)) return 8
  return Math.max(1, Math.min(MAX_QUERY_RESULTS, Math.floor(value)))
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function safeMessage(value: unknown, apiKey: string) {
  const message = value instanceof Error ? value.message : String(value ?? "unknown provider error")
  return message.split(apiKey).join("[REDACTED]").replace(/\s+/g, " ").trim().slice(0, 300)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function exactFilter(key: string, value: string) {
  return { key, match: { value } }
}

function anyFilter(key: string, values: readonly string[]) {
  return { key, match: { any: [...values] } }
}

function queryFilter(input: TickerKnowledgeQuery) {
  const must: Array<Record<string, unknown>> = [exactFilter("ticker", normalizeTicker(input.ticker))]
  if (input.knowledgeTypes?.length) must.push(anyFilter("knowledge_type", input.knowledgeTypes))
  if (input.sourceTypes?.length) must.push(anyFilter("source_type", input.sourceTypes))
  if (input.authorities?.length) must.push(anyFilter("authority", input.authorities))
  if (input.reportId) must.push(exactFilter("report_id", input.reportId))
  if (input.analysisId) must.push(exactFilter("analysis_id", input.analysisId))
  if (input.runId) must.push(exactFilter("run_id", input.runId))
  if (input.sourceId) must.push(exactFilter("source_id", input.sourceId))
  if (input.sourceVersion) must.push(exactFilter("source_version", input.sourceVersion))
  if (input.publishedFrom || input.publishedTo) {
    must.push({ key: "published_at", range: { ...(input.publishedFrom ? { gte: input.publishedFrom } : {}), ...(input.publishedTo ? { lte: input.publishedTo } : {}) } })
  }
  if (input.asOf) must.push({ key: "as_of", range: { lte: input.asOf } })
  return { must }
}

function itemPayload(
  item: TickerKnowledgeItem,
  derivedVersions: TickerKnowledgeDerivedVersions,
  indexedAt: string,
) {
  const provenance = item.provenance
  return {
    id: item.id,
    identity_key: item.identityKey,
    ticker: item.ticker,
    knowledge_type: item.knowledgeType,
    authority: item.authority,
    source_type: item.sourceType,
    text: item.text,
    source_id: provenance.sourceId,
    source_version: provenance.sourceVersion,
    content_hash: provenance.contentHash ?? null,
    report_id: provenance.reportId ?? null,
    analysis_id: provenance.analysisId ?? null,
    run_id: provenance.runId ?? null,
    page: provenance.page ?? null,
    chunk_id: provenance.chunkId ?? null,
    chunk_index: provenance.chunkIndex ?? null,
    published_at: provenance.publishedAt ?? null,
    as_of: provenance.asOf ?? null,
    storage_path: provenance.storagePath ?? null,
    schema_version: item.schemaVersion,
    projection_version: item.projectionVersion,
    embedding_model: derivedVersions.embeddingModel,
    embedding_version: derivedVersions.embeddingVersion,
    sparse_encoder: derivedVersions.sparseEncoder,
    sparse_version: derivedVersions.sparseVersion,
    indexed_at: indexedAt,
  }
}

function parsePayload(id: string, score: number, raw: unknown): TickerKnowledgeSearchResult {
  if (!isRecord(raw)) throw new TickerKnowledgeUnavailableError("invalid_response", "Qdrant result payload is missing")
  const ticker = stringOrNull(raw.ticker)
  const identityKey = stringOrNull(raw.identity_key)
  const knowledgeType = stringOrNull(raw.knowledge_type) as TickerKnowledgeType | null
  const authority = stringOrNull(raw.authority) as TickerKnowledgeAuthority | null
  const sourceType = stringOrNull(raw.source_type) as TickerKnowledgeSourceType | null
  const text = stringOrNull(raw.text)
  const sourceId = stringOrNull(raw.source_id)
  const sourceVersion = stringOrNull(raw.source_version)
  const schemaVersion = stringOrNull(raw.schema_version)
  const projectionVersion = stringOrNull(raw.projection_version)
  const embeddingModel = stringOrNull(raw.embedding_model)
  const embeddingVersion = stringOrNull(raw.embedding_version)
  const sparseEncoder = stringOrNull(raw.sparse_encoder)
  const sparseVersion = stringOrNull(raw.sparse_version)
  if (!ticker || !identityKey || !knowledgeType || !authority || !sourceType || !text || !sourceId || !sourceVersion || schemaVersion !== TICKER_KNOWLEDGE_SCHEMA_VERSION || !projectionVersion || !embeddingModel || !embeddingVersion || !sparseEncoder || !sparseVersion) {
    throw new TickerKnowledgeUnavailableError("invalid_response", "Qdrant result payload failed ticker knowledge contract")
  }

  return {
    id,
    score,
    item: {
      id,
      identityKey,
      ticker: normalizeTicker(ticker),
      knowledgeType,
      authority,
      sourceType,
      text,
      provenance: {
        sourceId,
        sourceVersion,
        contentHash: stringOrNull(raw.content_hash),
        reportId: stringOrNull(raw.report_id),
        analysisId: stringOrNull(raw.analysis_id),
        runId: stringOrNull(raw.run_id),
        page: numberOrNull(raw.page),
        chunkId: stringOrNull(raw.chunk_id),
        chunkIndex: numberOrNull(raw.chunk_index),
        publishedAt: stringOrNull(raw.published_at),
        asOf: stringOrNull(raw.as_of),
        storagePath: stringOrNull(raw.storage_path),
      },
      schemaVersion: TICKER_KNOWLEDGE_SCHEMA_VERSION,
      projectionVersion,
      indexedAt: stringOrNull(raw.indexed_at),
    },
    derivedVersions: { embeddingModel, embeddingVersion, sparseEncoder, sparseVersion },
  }
}

export function createQdrantTickerKnowledgeIndex(options: QdrantTickerKnowledgeIndexOptions): TickerKnowledgeIndex {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new TickerKnowledgeUnavailableError("not_configured", "QDRANT_API_KEY is required")
  const collectionName = options.collectionName ?? TICKER_KNOWLEDGE_COLLECTION
  if (collectionName !== TICKER_KNOWLEDGE_COLLECTION) {
    throw new TickerKnowledgeUnavailableError("not_configured", `Ticker knowledge collection must be ${TICKER_KNOWLEDGE_COLLECTION}`)
  }
  const embeddingProvider = options.embeddingProvider
  const vectorSize = options.vectorSize ?? embeddingProvider.dimensions
  if (!Number.isInteger(vectorSize) || vectorSize <= 0 || embeddingProvider.dimensions !== vectorSize) {
    throw new TickerKnowledgeUnavailableError("not_configured", "Ticker knowledge vector dimensions are inconsistent")
  }
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(500, Math.min(30_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)))

  const derivedVersions: TickerKnowledgeDerivedVersions = {
    embeddingModel: embeddingProvider.model,
    embeddingVersion: embeddingProvider.version,
    sparseEncoder: TICKER_KNOWLEDGE_SPARSE_ENCODER,
    sparseVersion: TICKER_KNOWLEDGE_SPARSE_VERSION,
  }

  async function request(path: string, init: RequestInit = {}, allow404 = false): Promise<{ response: Response; json: QdrantJson | null }> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          "api-key": apiKey,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      })
      let json: QdrantJson | null = null
      try {
        const parsed: unknown = await response.json()
        json = isRecord(parsed) ? parsed : null
      } catch {
        json = null
      }
      if (!response.ok && !(allow404 && response.status === 404)) {
        throw new TickerKnowledgeUnavailableError("qdrant_unavailable", `Qdrant request failed (${response.status})`)
      }
      return { response, json }
    } catch (error) {
      if (error instanceof TickerKnowledgeUnavailableError) throw error
      if (error instanceof Error && error.name === "AbortError") {
        throw new TickerKnowledgeUnavailableError("qdrant_timeout", "Qdrant request timed out")
      }
      throw new TickerKnowledgeUnavailableError("qdrant_unavailable", safeMessage(error, apiKey))
    } finally {
      clearTimeout(timeout)
    }
  }

  async function embed(texts: readonly string[]) {
    try {
      const vectors = await embeddingProvider.embed(texts)
      if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== vectorSize || vector.some((value) => !Number.isFinite(value)))) {
        throw new Error("Embedding provider returned invalid vector dimensions")
      }
      return vectors
    } catch (error) {
      if (error instanceof TickerKnowledgeUnavailableError) throw error
      throw new TickerKnowledgeUnavailableError("embedding_unavailable", safeMessage(error, apiKey))
    }
  }

  async function ensureReady() {
    const info = await request(`/collections/${encodeURIComponent(collectionName)}`, { method: "GET" }, true)
    if (info.response.status === 404) {
      await request(`/collections/${encodeURIComponent(collectionName)}`, {
        method: "PUT",
        body: JSON.stringify({
          vectors: {
            [DENSE_VECTOR_NAME]: { size: vectorSize, distance: "Cosine", on_disk: true },
          },
          sparse_vectors: {
            [SPARSE_VECTOR_NAME]: { index: { on_disk: true } },
          },
          metadata: {
            owner: "qeoindex",
            role: "derived_rebuildable_ticker_knowledge",
            schema_version: TICKER_KNOWLEDGE_SCHEMA_VERSION,
          },
        }),
      })
    } else if (info.json) {
      const result = isRecord(info.json.result) ? info.json.result : null
      const config = result && isRecord(result.config) ? result.config : null
      const params = config && isRecord(config.params) ? config.params : null
      const vectors = params && isRecord(params.vectors) ? params.vectors : null
      const dense = vectors && isRecord(vectors[DENSE_VECTOR_NAME]) ? vectors[DENSE_VECTOR_NAME] as Record<string, unknown> : null
      if (dense && Number(dense.size) !== vectorSize) {
        throw new TickerKnowledgeUnavailableError("invalid_response", `Qdrant dense vector size mismatch: expected ${vectorSize}`)
      }
    }

    for (const [fieldName, fieldSchema] of PAYLOAD_INDEXES) {
      const response = await request(`/collections/${encodeURIComponent(collectionName)}/index?wait=true`, {
        method: "PUT",
        body: JSON.stringify({ field_name: fieldName, field_schema: fieldSchema }),
      })
      if (!response.json) throw new TickerKnowledgeUnavailableError("invalid_response", `Qdrant payload index response missing for ${fieldName}`)
    }
  }

  async function upsert(items: readonly TickerKnowledgeItem[]) {
    if (items.length === 0) return
    if (items.length > MAX_UPSERT_BATCH) throw new Error(`Ticker knowledge upsert is limited to ${MAX_UPSERT_BATCH} items per call`)
    const vectors = await embed(items.map((item) => item.text))
    const indexedAt = new Date().toISOString()
    const points = items.map((item, index) => {
      const sparse = encodeTickerKnowledgeSparse(item.text)
      return {
        id: item.id,
        vector: {
          [DENSE_VECTOR_NAME]: vectors[index],
          [SPARSE_VECTOR_NAME]: sparse,
        },
        payload: itemPayload(item, derivedVersions, indexedAt),
      }
    })
    await request(`/collections/${encodeURIComponent(collectionName)}/points?wait=true`, {
      method: "PUT",
      body: JSON.stringify({ points }),
    })
  }

  async function query(input: TickerKnowledgeQuery) {
    const text = normalizeText(input.text)
    if (!text) return []
    const limit = normalizedLimit(input.limit)
    const filter = queryFilter(input)
    const [dense] = await embed([text])
    const sparse = encodeTickerKnowledgeSparse(text)
    const prefetchLimit = Math.min(64, Math.max(20, limit * 4))
    const prefetch: Array<Record<string, unknown>> = [{
      query: dense,
      using: DENSE_VECTOR_NAME,
      filter,
      limit: prefetchLimit,
    }]
    if (sparse.indices.length > 0) {
      prefetch.push({
        query: sparse,
        using: SPARSE_VECTOR_NAME,
        filter,
        limit: prefetchLimit,
      })
    }

    const response = await request(`/collections/${encodeURIComponent(collectionName)}/points/query`, {
      method: "POST",
      body: JSON.stringify({
        prefetch,
        query: { fusion: "rrf" },
        filter,
        limit,
        with_payload: true,
        with_vector: false,
      }),
    })
    const result = response.json && isRecord(response.json.result) ? response.json.result : null
    const points = result && Array.isArray(result.points) ? result.points : null
    if (!points) throw new TickerKnowledgeUnavailableError("invalid_response", "Qdrant query response is missing result.points")
    const ticker = normalizeTicker(input.ticker)
    return points.map((value): TickerKnowledgeSearchResult => {
      if (!isRecord(value)) throw new TickerKnowledgeUnavailableError("invalid_response", "Qdrant query returned an invalid point")
      const id = stringOrNull(value.id)
      const score = numberOrNull(value.score)
      if (!id || score === null) throw new TickerKnowledgeUnavailableError("invalid_response", "Qdrant query point identity is invalid")
      const parsed = parsePayload(id, score, value.payload)
      if (parsed.item.ticker !== ticker) throw new TickerKnowledgeUnavailableError("invalid_response", "Qdrant violated ticker isolation")
      return parsed
    }).slice(0, limit)
  }

  async function deleteSourceVersion(input: { ticker: string; sourceType: TickerKnowledgeSourceType; sourceId: string; sourceVersion: string }) {
    const ticker = normalizeTicker(input.ticker)
    const sourceId = normalizeText(input.sourceId)
    const sourceVersion = normalizeText(input.sourceVersion)
    if (!sourceId || !sourceVersion) throw new Error("sourceId and sourceVersion are required for source-version-aware deletion")
    await request(`/collections/${encodeURIComponent(collectionName)}/points/delete?wait=true`, {
      method: "POST",
      body: JSON.stringify({
        filter: {
          must: [
            exactFilter("ticker", ticker),
            exactFilter("source_type", input.sourceType),
            exactFilter("source_id", sourceId),
            exactFilter("source_version", sourceVersion),
          ],
        },
      }),
    })
  }

  return { ensureReady, upsert, query, deleteSourceVersion }
}
