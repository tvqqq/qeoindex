import "server-only"

import {
  TICKER_KNOWLEDGE_COLLECTION,
  TickerKnowledgeUnavailableError,
  type TickerKnowledgeIndex,
} from "./domain.ts"
import { createOpenAiTickerKnowledgeEmbeddingProvider } from "./embedding.ts"
import { createQdrantTickerKnowledgeIndex } from "./qdrant.ts"

const DEFAULT_VECTOR_SIZE = 1536

function positiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new TickerKnowledgeUnavailableError("not_configured", `${name} must be a positive integer`)
  }
  return value
}

export interface ServerTickerKnowledgeDependencies {
  fetchImpl?: typeof fetch
}

export function createServerTickerKnowledgeIndex(deps: ServerTickerKnowledgeDependencies = {}): TickerKnowledgeIndex {
  const baseUrl = process.env.QDRANT_URL?.trim()
  const qdrantApiKey = process.env.QDRANT_API_KEY?.trim()
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim()
  if (!baseUrl || !qdrantApiKey || !openAiApiKey) {
    throw new TickerKnowledgeUnavailableError(
      "not_configured",
      "Ticker knowledge requires QDRANT_URL, QDRANT_API_KEY and OPENAI_API_KEY",
    )
  }
  const dimensions = positiveIntegerEnv("TICKER_KNOWLEDGE_VECTOR_SIZE", DEFAULT_VECTOR_SIZE)
  const embedding = createOpenAiTickerKnowledgeEmbeddingProvider({
    apiKey: openAiApiKey,
    model: process.env.TICKER_KNOWLEDGE_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    dimensions,
    fetchImpl: deps.fetchImpl,
  })
  return createQdrantTickerKnowledgeIndex({
    baseUrl,
    apiKey: qdrantApiKey,
    collectionName: TICKER_KNOWLEDGE_COLLECTION,
    vectorSize: dimensions,
    embeddingProvider: embedding,
    fetchImpl: deps.fetchImpl,
  })
}
