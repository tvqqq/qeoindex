import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  NOTION_API_VERSION,
  retrieveBlockChildren,
} from "../lib/notion/client.ts"

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
  const research = source("lib/ai-council-research-context.ts")

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
  const wrapper = source("lib/ai-council-pre-market-evidence.ts")
  const migration = source("supabase/migrations/20260824080500_ai_council_llm_research_context.sql")
  const operations = source("lib/ai-council-operations.ts")
  const route = source("app/api/ai-council/debate-daily/route.ts")

  assert.match(wrapper, /enrichCouncilStocksWithLlmEvidence/)
  assert.match(wrapper, /freezeCouncilResearchContext/)
  assert.match(wrapper, /ai_council_llm_evidence/)
  assert.doesNotMatch(wrapper, /\[P4\.3_NOTION_RESEARCH_CONTEXT\]/)
  assert.match(wrapper, /researchContext: \{/)
  const rawEvidence = source("lib/ai-council-llm-evidence.ts")
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
  const code = source("lib/ai-council-research-context.ts")
  assert.match(code, /export function configuredCouncilResearchTickers\(raw\?: string \| string\[\]\)/)
  assert.match(code, /Array\.isArray\(raw\)/)
  assert.match(code, /isCouncilResearchTickerEnabled\(ticker: string, raw\?: string \| string\[\]\)/)
})

