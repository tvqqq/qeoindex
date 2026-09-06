import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  NOTION_API_VERSION,
  retrieveBlockChildren,
} from "../modules/notion/client.ts"

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

function withNotionToken() {
  const previousApiKey = process.env.NOTION_API_KEY
  const previousToken = process.env.NOTION_TOKEN
  process.env.NOTION_API_KEY = "test-token"
  delete process.env.NOTION_TOKEN
  return () => {
    if (previousApiKey === undefined) delete process.env.NOTION_API_KEY
    else process.env.NOTION_API_KEY = previousApiKey
    if (previousToken === undefined) delete process.env.NOTION_TOKEN
    else process.env.NOTION_TOKEN = previousToken
  }
}

test("Notion adapter retrieves paginated block children with no-store GET", async () => {
  const restoreToken = withNotionToken()
  const originalFetch = globalThis.fetch
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let page = 0

  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    page += 1
    return new Response(JSON.stringify(page === 1
      ? {
          results: [{ id: "block-1", type: "paragraph", has_children: false, paragraph: { rich_text: [] } }],
          has_more: true,
          next_cursor: "cursor-2",
        }
      : {
          results: [{ id: "block-2", type: "table_row", has_children: false, table_row: { cells: [] } }],
          has_more: false,
          next_cursor: null,
        }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  try {
    const result = await retrieveBlockChildren("page-1", {
      pageSize: 50,
      maxPages: 3,
    })

    assert.deepEqual(result.results.map((block) => block.id), ["block-1", "block-2"])
    assert.equal(calls.length, 2)
    assert.equal(calls[0].init?.method, "GET")
    assert.equal(calls[0].init?.body, undefined)
    assert.match(calls[0].url, /\/blocks\/page-1\/children\?page_size=50$/)
    assert.match(calls[1].url, /start_cursor=cursor-2/)
    const headers = calls[0].init?.headers as Record<string, string>
    assert.equal(headers["Notion-Version"], NOTION_API_VERSION)
    assert.equal(calls[0].init?.cache, "no-store")
  } finally {
    globalThis.fetch = originalFetch
    restoreToken()
  }
})

test("pre-market Research Context is MSN-pilot, point-in-time filtered, source-ranked and bounded", () => {
  const research = source("modules/ai-council/research-context.ts")

  assert.match(research, /AI_COUNCIL_RESEARCH_CONTEXT_VERSION = "notion-research-context-v1"/)
  assert.match(research, /DEFAULT_PILOT_TICKERS = "MSN"/)
  assert.match(research, /NOTION_STOCK_THESIS_DATA_SOURCE_ID/)
  assert.match(research, /NOTION_RESEARCH_SOURCES_DATA_SOURCE_ID/)
  assert.match(research, /"fa161c1b-3f37-4ee2-8d75-0ca64a05ee90"/)
  assert.match(research, /"f0e2b054-e37c-436b-b0b5-93e97f7f7eec"/)
  assert.match(research, /TOTAL_RESEARCH_TOKEN_BUDGET = 13_000/)
  assert.match(research, /THESIS_CHAR_BUDGET = 12_000/)
  assert.match(research, /BROKER_COMBINED_CHAR_BUDGET = 9_000/)
  assert.match(research, /S: 5/)
  assert.match(research, /A: 4/)
  assert.match(research, /B: 3/)
  assert.match(research, /property: "Status", select: \{ equals: "Current" \}/)
  assert.match(research, /property: "Published Date", date: \{ on_or_before: asOfDate \}/)
  assert.match(research, /property: "Ingested", date: \{ on_or_before: asOfDate \}/)
  assert.match(research, /Broker forecasts, recommendations and target prices are opinions, not verified company facts/)
  assert.match(research, /Historical replay before the first frozen research snapshot cannot be reconstructed exactly/)
})

test("pre-market wrapper combines frozen raw evidence with immutable Notion research audit identity", () => {
  const wrapper = source("modules/ai-council/pre-market-evidence.ts")
  const migration = source("supabase/migrations/20260824080500_ai_council_llm_research_context.sql")
  const operations = source("modules/ai-council/operations.ts")
  const route = source("app/api/ai-council/debate-daily/route.ts")

  assert.match(wrapper, /enrichCouncilStocksWithLlmEvidence/)
  assert.match(wrapper, /freezeCouncilResearchContext/)
  assert.match(wrapper, /ai_council_llm_evidence/)
  assert.doesNotMatch(wrapper, /\[P4\.3_NOTION_RESEARCH_CONTEXT\]/)
  assert.match(wrapper, /researchContext: \{/)
  const rawEvidence = source("modules/ai-council/llm-evidence.ts")
  assert.match(rawEvidence, /llmEvidence: \{/)
  assert.doesNotMatch(rawEvidence, /P4\.3_EVIDENCE_FIDELITY_CONTEXT/)
  assert.match(wrapper, /promptIdentityHash/)
  assert.match(wrapper, /isCouncilResearchTickerEnabled/)

  assert.match(migration, /create table if not exists public\.ai_council_llm_research_contexts/)
  assert.match(migration, /context_hash text not null check \(context_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.match(migration, /raw_context_hash text not null/)
  assert.match(migration, /prompt_identity_hash text not null/)
  assert.match(migration, /source_page_ids jsonb not null/)
  assert.match(migration, /source_last_edited jsonb not null/)
  assert.match(migration, /before update on public\.ai_council_llm_research_contexts/)
  assert.match(migration, /grant select on table public\.ai_council_llm_research_contexts to authenticated/)

  assert.match(route, /runAiCouncilDebateOperation/)
  assert.match(route, /isMachineRequestAuthorized/)
  assert.match(operations, /enrichCouncilStocksForDebate/)
  assert.match(operations, /promptVersion: AI_COUNCIL_LLM_PROMPT_VERSION/)
  assert.match(operations, /configuredCouncilResearchTickers/)
  assert.match(operations, /researchContext:/)
  assert.match(operations, /firstValidationTicker/)
  assert.match(operations, /finalAuthority: "deterministic"/)
})

test("configuredCouncilResearchTickers accepts explicit runtime lists without mutating env", () => {
  const code = source("modules/ai-council/research-context.ts")
  assert.match(code, /export function configuredCouncilResearchTickers\(raw\?: string \| string\[\]\)/)
  assert.match(code, /Array\.isArray\(raw\)/)
  assert.match(code, /isCouncilResearchTickerEnabled\(ticker: string, raw\?: string \| string\[\]\)/)
})

test("QEO-86 pre-market freezes auditable Research Reports for every Council ticker without inheriting the Notion pilot gate", () => {
  const wrapper = source("modules/ai-council/pre-market-evidence.ts")

  assert.match(wrapper, /AI_COUNCIL_REPORT_EVIDENCE_VERSION/)
  assert.match(wrapper, /freezeCouncilReportEvidence/)
  assert.match(wrapper, /const reportSelectionRunAt = new Date\(\)\.toISOString\(\)/)
  assert.match(wrapper, /const reportStocks = raw\.stocks/)
  assert.match(wrapper, /for \(const stock of reportStocks\)/)
  assert.match(wrapper, /canUseInPrompt/)
  assert.match(wrapper, /reportEvidence: \{/)
  assert.match(wrapper, /Curated Research Report evidence for advisory LLM reasoning only/)
  assert.doesNotMatch(wrapper, /const reportStocks = raw\.stocks\.filter\(\(stock\) => isCouncilResearchTickerEnabled/)
})

test("QEO-110 ticker knowledge identity is deterministic, ticker-scoped and retry-safe", async () => {
  const {
    TICKER_KNOWLEDGE_SCHEMA_VERSION,
    createTickerKnowledgeIdentity,
  } = await import("../modules/ticker-knowledge/domain.ts")

  const input = {
    ticker: "msn",
    knowledgeType: "REPORT_CHUNK" as const,
    sourceType: "RESEARCH_REPORT" as const,
    sourceId: "report-1",
    logicalKey: "report-1:hash-v1:chunk-7",
  }
  const first = createTickerKnowledgeIdentity(input)
  const retry = createTickerKnowledgeIdentity({ ...input, ticker: "MSN" })
  const otherTicker = createTickerKnowledgeIdentity({ ...input, ticker: "VIC" })

  assert.equal(first.id, retry.id)
  assert.equal(first.identityKey, retry.identityKey)
  assert.equal(first.ticker, "MSN")
  assert.equal(first.schemaVersion, TICKER_KNOWLEDGE_SCHEMA_VERSION)
  assert.notEqual(first.id, otherTicker.id)
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test("QEO-112 local sparse encoder preserves financial lexical anchors and numbers", async () => {
  const { encodeTickerKnowledgeSparse } = await import("../modules/ticker-knowledge/sparse.ts")

  const document = encodeTickerKnowledgeSparse("MSN target 110,000 EV/EBITDA 2027F")
  const query = encodeTickerKnowledgeSparse("MSN 110000 EBITDA")
  const documentIndices = new Set(document.indices)
  const overlap = query.indices.filter((index) => documentIndices.has(index))

  assert.equal(document.indices.length, document.values.length)
  assert.deepEqual([...document.indices].sort((a, b) => a - b), document.indices)
  assert.ok(overlap.length >= 3)
})

test("QEO-112 Qdrant hybrid query always filters ticker first and fuses dense+sparse evidence", async () => {
  const { createQdrantTickerKnowledgeIndex } = await import("../modules/ticker-knowledge/qdrant.ts")
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    calls.push({ url: String(input), body })
    return new Response(JSON.stringify({ result: { points: [] }, status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  const index = createQdrantTickerKnowledgeIndex({
    baseUrl: "https://example.qdrant.io",
    apiKey: "secret-qdrant-key",
    collectionName: "ticker_knowledge",
    vectorSize: 3,
    fetchImpl,
    embeddingProvider: {
      model: "test-embedding",
      version: "test-embedding-v1",
      dimensions: 3,
      embed: async () => [[0.1, 0.2, 0.3]],
    },
  })

  const result = await index.query({
    ticker: "msn",
    text: "HSBC target 110000 dựa trên giả định gì?",
    knowledgeTypes: ["REPORT_CHUNK", "REPORT_SUMMARY"],
    limit: 8,
  })

  assert.deepEqual(result, [])
  assert.equal(calls.length, 1)
  assert.match(calls[0].url, /\/collections\/ticker_knowledge\/points\/query$/)
  assert.deepEqual((calls[0].body.query as { fusion?: string }).fusion, "rrf")
  assert.equal((calls[0].body.prefetch as unknown[]).length, 2)
  const filter = calls[0].body.filter as { must: Array<Record<string, unknown>> }
  assert.deepEqual(filter.must[0], { key: "ticker", match: { value: "MSN" } })
})

test("QEO-110 Qdrant outage degrades explicitly instead of impersonating empty knowledge", async () => {
  const {
    TickerKnowledgeUnavailableError,
    queryTickerKnowledgeSafely,
  } = await import("../modules/ticker-knowledge/domain.ts")

  const result = await queryTickerKnowledgeSafely({
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async () => undefined,
    query: async () => {
      throw new TickerKnowledgeUnavailableError("qdrant_unavailable", "Qdrant unavailable")
    },
  }, {
    ticker: "MSN",
    text: "current thesis",
  })

  assert.equal(result.status, "unavailable")
  assert.deepEqual(result.results, [])
  assert.equal(result.reason, "qdrant_unavailable")
})

test("QEO-111 cold evidence archive round-trips, reuses retries and fails closed on checksum mismatch", async () => {
  const { createSupabaseColdEvidenceStore } = await import("../modules/ticker-knowledge/cold-evidence.ts")
  const objects = new Map<string, Uint8Array>()
  const fakeSupabase = {
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (objects.has(path)) return { error: { message: "The resource already exists" } }
          objects.set(path, new Uint8Array(bytes))
          return { error: null }
        },
        download: async (path: string) => {
          const bytes = objects.get(path)
          return bytes
            ? { data: new Blob([bytes]), error: null }
            : { data: null, error: { message: "not found" } }
        },
      }),
    },
  }

  const store = createSupabaseColdEvidenceStore(fakeSupabase as never, { bucket: "ticker-evidence" })
  const input = {
    domain: "AI_COUNCIL" as const,
    ticker: "MSN",
    sourceId: "run-123",
    sourceVersion: "council-run-v1",
    asOf: "2026-09-06T08:00:00.000Z",
    payload: { scenario: "BASE", probability: 0.55, evidence: ["a", "b"] },
  }

  const first = await store.archiveJson(input)
  const retry = await store.archiveJson(input)
  assert.equal(first.pointer.objectPath, retry.pointer.objectPath)
  assert.equal(first.reused, false)
  assert.equal(retry.reused, true)
  assert.deepEqual((await store.restoreJson(first.pointer)).payload, input.payload)

  const stored = objects.get(first.pointer.objectPath)
  assert.ok(stored)
  const tampered = new Uint8Array(stored)
  tampered[tampered.length - 1] ^= 1
  objects.set(first.pointer.objectPath, tampered)
  await assert.rejects(() => store.restoreJson(first.pointer), /checksum mismatch/i)
})
