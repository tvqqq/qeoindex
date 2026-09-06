import assert from "node:assert/strict"
import test from "node:test"

import { buildTickerContext } from "../../modules/ticker-knowledge/context.ts"
import {
  createTickerKnowledgeItem,
  type TickerKnowledgeIndex,
  type TickerKnowledgeSearchResult,
} from "../../modules/ticker-knowledge/domain.ts"

function item(input: {
  key: string
  text: string
  authority?: "CANONICAL_THESIS" | "SOURCE_OPINION" | "DETERMINISTIC_SIGNAL"
  sourceType?: "NOTION_THESIS" | "RESEARCH_REPORT" | "AI_COUNCIL"
  asOf?: string
}) {
  const sourceType = input.sourceType ?? "RESEARCH_REPORT"
  return createTickerKnowledgeItem({
    ticker: "MSN",
    knowledgeType: sourceType === "NOTION_THESIS" ? "CURRENT_THESIS" : sourceType === "AI_COUNCIL" ? "COUNCIL_MEMORY" : "REPORT_SUMMARY",
    authority: input.authority ?? "SOURCE_OPINION",
    sourceType,
    logicalKey: input.key,
    text: input.text,
    provenance: {
      sourceId: `source-${input.key}`,
      sourceVersion: `version-${input.key}`,
      asOf: input.asOf ?? "2026-09-05T00:00:00.000Z",
    },
    projectionVersion: "test-v1",
  })
}

function searchResult(value: ReturnType<typeof item>, score: number): TickerKnowledgeSearchResult {
  return {
    id: value.id,
    score,
    item: value,
    derivedVersions: {
      embeddingModel: "test",
      embeddingVersion: "test",
      sparseEncoder: "test",
      sparseVersion: "test",
    },
  }
}

function index(results: readonly TickerKnowledgeSearchResult[]): TickerKnowledgeIndex {
  return {
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async () => undefined,
    query: async () => [...results],
  }
}

test("QEO-115 character budget bounds items and retrieved identities, not only rendered text", async () => {
  const thesis = item({
    key: "thesis",
    text: `Canonical thesis ${"T".repeat(220)}`,
    authority: "CANONICAL_THESIS",
    sourceType: "NOTION_THESIS",
  })
  const council = item({
    key: "council",
    text: `Council state ${"C".repeat(220)}`,
    authority: "DETERMINISTIC_SIGNAL",
    sourceType: "AI_COUNCIL",
  })
  const reportA = item({ key: "report-a", text: `Broker evidence A ${"A".repeat(220)}` })
  const reportB = item({ key: "report-b", text: `Broker evidence B ${"B".repeat(220)}` })

  const result = await buildTickerContext({
    index: index([searchResult(reportA, 0.9), searchResult(reportB, 0.8)]),
    ticker: "MSN",
    query: "valuation catalyst",
    consumer: "AI_COUNCIL",
    mandatory: [thesis, council],
    maxChars: 500,
    now: "2026-09-06T00:00:00.000Z",
  })

  assert.ok(result.text.length <= 500)
  assert.equal(result.truncated, true)
  assert.ok(result.items.length < 4, "out-of-budget items must not survive in structured context")
  assert.deepEqual(
    result.retrievedPointIds,
    result.items.filter((value) => value.id === reportA.id || value.id === reportB.id).map((value) => value.id),
  )
  assert.ok(result.items.every((value) => result.text.includes(value.text.slice(0, 24))))
})

test("QEO-115 partial-fit structured item carries only the bounded rendered text", async () => {
  const huge = item({
    key: "huge-thesis",
    text: `Huge canonical thesis ${"H".repeat(5_000)}`,
    authority: "CANONICAL_THESIS",
    sourceType: "NOTION_THESIS",
  })

  const result = await buildTickerContext({
    index: index([]),
    ticker: "MSN",
    query: "current thesis",
    mandatory: [huge],
    maxChars: 500,
    now: "2026-09-06T00:00:00.000Z",
  })

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, huge.id)
  assert.equal(result.items[0].provenance.sourceVersion, huge.provenance.sourceVersion)
  assert.ok(result.items[0].text.length < huge.text.length)
  assert.ok(result.items[0].text.endsWith("…"))
  assert.ok(result.text.length <= 500)
})

test("QEO-115 preserves contradictory authorities as separate ordered items instead of averaging them", async () => {
  const deterministic = item({
    key: "deterministic",
    text: "Deterministic signal: REDUCE",
    authority: "DETERMINISTIC_SIGNAL",
    sourceType: "AI_COUNCIL",
  })
  const broker = item({
    key: "broker",
    text: "Broker opinion: BUY, target 120",
    authority: "SOURCE_OPINION",
    sourceType: "RESEARCH_REPORT",
  })

  const result = await buildTickerContext({
    index: index([searchResult(broker, 1)]),
    ticker: "MSN",
    query: "investment view",
    mandatory: [deterministic],
    maxChars: 2000,
    now: "2026-09-06T00:00:00.000Z",
  })

  assert.deepEqual(result.items.map((value) => value.authority), ["DETERMINISTIC_SIGNAL", "SOURCE_OPINION"])
  assert.match(result.text, /Deterministic signal: REDUCE/)
  assert.match(result.text, /Broker opinion: BUY, target 120/)
  assert.doesNotMatch(result.text, /consensus|average/i)
})

test("QEO-115 historical ranking uses asOf as the default recency clock", async () => {
  const olderHighSemantic = item({
    key: "older-high-semantic",
    text: "Older high semantic match",
    asOf: "2024-03-01T00:00:00.000Z",
  })
  const recentNearEqual = item({
    key: "recent-near-equal",
    text: "Recent near-equal semantic match",
    asOf: "2024-09-05T00:00:00.000Z",
  })
  const normalizationFloor = item({
    key: "normalization-floor",
    text: "Low relevance floor",
    asOf: "2024-01-01T00:00:00.000Z",
  })

  const result = await buildTickerContext({
    index: index([
      searchResult(olderHighSemantic, 1),
      searchResult(recentNearEqual, 0.99),
      searchResult(normalizationFloor, 0),
    ]),
    ticker: "MSN",
    query: "historical view",
    asOf: "2024-09-06T00:00:00.000Z",
    maxChars: 4000,
  })

  assert.equal(result.items[0].id, recentNearEqual.id)
  assert.equal(result.items[1].id, olderHighSemantic.id)
})
