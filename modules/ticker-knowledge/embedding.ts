import "server-only"

import type { TickerKnowledgeEmbeddingProvider } from "./domain.ts"

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"
const DEFAULT_TIMEOUT_MS = 20_000
const MAX_EMBED_BATCH = 64

export interface OpenAiEmbeddingProviderOptions {
  apiKey: string
  model?: string
  dimensions?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function safeProviderMessage(value: unknown, apiKey: string) {
  const message = value instanceof Error ? value.message : String(value ?? "OpenAI embedding request failed")
  return message.split(apiKey).join("[REDACTED]").replace(/\s+/g, " ").trim().slice(0, 300)
}

export function createOpenAiTickerKnowledgeEmbeddingProvider(options: OpenAiEmbeddingProviderOptions): TickerKnowledgeEmbeddingProvider {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for ticker knowledge embeddings")
  const model = options.model?.trim() || "text-embedding-3-small"
  const dimensions = Math.max(1, Math.floor(options.dimensions ?? 1536))
  const timeoutMs = Math.max(1_000, Math.min(60_000, Math.floor(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)))
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    model,
    dimensions,
    version: `openai:${model}:${dimensions}:v1`,
    async embed(texts: readonly string[]) {
      if (texts.length === 0) return []
      if (texts.length > MAX_EMBED_BATCH) throw new Error(`Embedding batch is limited to ${MAX_EMBED_BATCH} inputs`)
      const normalized = texts.map((text) => text.replace(/\s+/g, " ").trim())
      if (normalized.some((text) => !text)) throw new Error("Embedding input cannot be empty")

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(OPENAI_EMBEDDINGS_URL, {
          method: "POST",
          cache: "no-store",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            input: normalized,
            encoding_format: "float",
            dimensions,
          }),
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`OpenAI embeddings failed (${response.status})`)
        const payload: unknown = await response.json()
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("OpenAI embeddings returned an invalid envelope")
        const rows = (payload as { data?: unknown }).data
        if (!Array.isArray(rows) || rows.length !== normalized.length) throw new Error("OpenAI embeddings returned an invalid data array")
        const ordered = rows.slice().sort((a, b) => Number((a as { index?: unknown }).index) - Number((b as { index?: unknown }).index))
        return ordered.map((row) => {
          const embedding = row && typeof row === "object" && !Array.isArray(row)
            ? (row as { embedding?: unknown }).embedding
            : null
          if (!Array.isArray(embedding) || embedding.length !== dimensions || embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
            throw new Error("OpenAI embeddings returned invalid vector dimensions")
          }
          return embedding as number[]
        })
      } catch (error) {
        throw new Error(safeProviderMessage(error, apiKey))
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
