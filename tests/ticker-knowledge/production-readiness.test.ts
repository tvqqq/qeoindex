import assert from "node:assert/strict"
import test from "node:test"

import { createQdrantTickerKnowledgeIndex } from "../../modules/ticker-knowledge/qdrant.ts"

const denseConfig = {
  size: 3,
  distance: "Cosine",
  on_disk: true,
}

function embeddingProvider() {
  return {
    model: "test-embedding",
    version: "test-embedding-v1",
    dimensions: 3,
    embed: async () => [[0.1, 0.2, 0.3]],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

test("QEO-119 first semantic query provisions a missing ticker_knowledge collection before querying", async () => {
  const calls: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
  let collectionExists = false
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = String(init?.method ?? "GET")
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
    calls.push({ method, url, body })

    if (method === "GET" && url.endsWith("/collections/ticker_knowledge")) {
      return collectionExists
        ? jsonResponse({
            result: {
              config: { params: { vectors: { dense: denseConfig }, sparse_vectors: { lexical: {} } } },
              payload_schema: {},
            },
            status: "ok",
          })
        : jsonResponse({ status: { error: "Not found" } }, 404)
    }
    if (method === "PUT" && url.endsWith("/collections/ticker_knowledge")) {
      collectionExists = true
      return jsonResponse({ result: true, status: "ok" })
    }
    if (method === "PUT" && url.includes("/index?wait=true")) {
      return jsonResponse({ result: true, status: "ok" })
    }
    if (method === "POST" && url.endsWith("/points/query")) {
      return jsonResponse({ result: { points: [] }, status: "ok" })
    }
    throw new Error(`Unexpected ${method} ${url}`)
  }

  const index = createQdrantTickerKnowledgeIndex({
    baseUrl: "https://example.qdrant.io",
    apiKey: "test-key",
    vectorSize: 3,
    fetchImpl,
    embeddingProvider: embeddingProvider(),
  })

  const result = await index.query({ ticker: "MSN", text: "MSN target 110000 EBITDA", limit: 4 })

  assert.deepEqual(result, [])
  assert.equal(calls[0]?.method, "GET")
  assert.match(calls[0]?.url ?? "", /\/collections\/ticker_knowledge$/)
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.endsWith("/collections/ticker_knowledge")))
  const queryCall = calls.findIndex((call) => call.method === "POST" && call.url.endsWith("/points/query"))
  const createCall = calls.findIndex((call) => call.method === "PUT" && call.url.endsWith("/collections/ticker_knowledge"))
  assert.ok(createCall >= 0 && queryCall > createCall)
})

test("QEO-119 readiness rejects an existing collection without the lexical sparse vector", async () => {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    if ((init?.method ?? "GET") === "GET" && url.endsWith("/collections/ticker_knowledge")) {
      return jsonResponse({
        result: {
          config: { params: { vectors: { dense: denseConfig }, sparse_vectors: {} } },
          payload_schema: {},
        },
        status: "ok",
      })
    }
    if (init?.method === "PUT" && url.includes("/index?wait=true")) {
      return jsonResponse({ result: true, status: "ok" })
    }
    throw new Error(`Unexpected request ${String(init?.method ?? "GET")} ${url}`)
  }

  const index = createQdrantTickerKnowledgeIndex({
    baseUrl: "https://example.qdrant.io",
    apiKey: "test-key",
    vectorSize: 3,
    fetchImpl,
    embeddingProvider: embeddingProvider(),
  })

  await assert.rejects(
    () => index.ensureReady(),
    /lexical sparse vector/i,
  )
})

test("QEO-119 readiness creates only missing payload indexes on an existing healthy collection", async () => {
  const payloadSchema: Record<string, { data_type: string }> = {
    ticker: { data_type: "keyword" },
    knowledge_type: { data_type: "keyword" },
    source_type: { data_type: "keyword" },
    authority: { data_type: "keyword" },
    source_id: { data_type: "keyword" },
    source_version: { data_type: "keyword" },
    content_hash: { data_type: "keyword" },
    report_id: { data_type: "keyword" },
    analysis_id: { data_type: "keyword" },
    chunk_version: { data_type: "keyword" },
    run_id: { data_type: "keyword" },
    published_at: { data_type: "datetime" },
    // as_of intentionally missing
  }
  const indexWrites: string[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    if ((init?.method ?? "GET") === "GET" && url.endsWith("/collections/ticker_knowledge")) {
      return jsonResponse({
        result: {
          config: { params: { vectors: { dense: denseConfig }, sparse_vectors: { lexical: {} } } },
          payload_schema: payloadSchema,
        },
        status: "ok",
      })
    }
    if (init?.method === "PUT" && url.includes("/index?wait=true")) {
      const body = JSON.parse(String(init.body)) as { field_name?: string }
      indexWrites.push(String(body.field_name ?? ""))
      return jsonResponse({ result: true, status: "ok" })
    }
    throw new Error(`Unexpected request ${String(init?.method ?? "GET")} ${url}`)
  }

  const index = createQdrantTickerKnowledgeIndex({
    baseUrl: "https://example.qdrant.io",
    apiKey: "test-key",
    vectorSize: 3,
    fetchImpl,
    embeddingProvider: embeddingProvider(),
  })

  await index.ensureReady()

  assert.deepEqual(indexWrites, ["as_of"])
})
