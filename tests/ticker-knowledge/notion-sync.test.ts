import assert from "node:assert/strict"
import test from "node:test"

import type { Thesis } from "../../modules/research/types.ts"
import {
  inspectCurrentThesisProjection,
  rebuildCurrentThesisKnowledge,
} from "../../modules/ticker-knowledge/notion-sync.ts"
import {
  TickerKnowledgeUnavailableError,
  type TickerKnowledgeIndex,
  type TickerKnowledgeItem,
  type TickerKnowledgeQuery,
  type TickerKnowledgeSearchResult,
} from "../../modules/ticker-knowledge/domain.ts"
import { projectCurrentThesisKnowledge } from "../../modules/ticker-knowledge/projections.ts"

const THESIS: Thesis = {
  id: "notion-page-msn",
  notionUrl: "https://www.notion.so/notion-page-msn",
  ticker: "MSN",
  company: "Masan Group",
  status: "Current",
  taBias: "Bullish",
  faBias: "Bullish",
  wyckoffState: "Markup",
  marketRegime: "Risk-On",
  baseCase: "Base case",
  probabilities: { bull: 0.4, base: 0.45, bear: 0.15 },
  support: "80",
  resistance: "90",
  confirmation: "Close above 90",
  invalidation: "Close below 80",
  whatChanged: "Earnings improved",
  confidence: "HIGH",
  lastAnalysis: "2026-09-05T10:00:00.000Z",
  lastFAUpdate: "2026-09-04T10:00:00.000Z",
  updated: "2026-09-06T03:00:00.000Z",
  driveFolder: "",
}

function searchResult(item: TickerKnowledgeItem): TickerKnowledgeSearchResult {
  return {
    id: item.id,
    score: 1,
    item,
    derivedVersions: {
      embeddingModel: "test",
      embeddingVersion: "test",
      sparseEncoder: "test",
      sparseVersion: "test",
    },
  }
}

function indexWithQuery(query: (input: TickerKnowledgeQuery) => Promise<TickerKnowledgeSearchResult[]>): TickerKnowledgeIndex {
  return {
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async () => undefined,
    query,
  }
}

test("QEO-114 observes CURRENT_THESIS as current only when the indexed canonical version matches Notion", async () => {
  const projected = projectCurrentThesisKnowledge(THESIS)
  const queries: TickerKnowledgeQuery[] = []
  const index = indexWithQuery(async (input) => {
    queries.push(input)
    return [searchResult({ ...projected, indexedAt: "2026-09-06T03:05:00.000Z" })]
  })

  const status = await inspectCurrentThesisProjection(index, THESIS)

  assert.deepEqual(queries, [{
    ticker: "MSN",
    text: "current stock thesis MSN",
    knowledgeTypes: ["CURRENT_THESIS"],
    sourceTypes: ["NOTION_THESIS"],
    authorities: ["CANONICAL_THESIS"],
    sourceId: "notion-page-msn",
    limit: 4,
  }])
  assert.deepEqual(status, {
    ticker: "MSN",
    pointId: projected.id,
    canonicalSourceVersion: projected.provenance.sourceVersion,
    indexedSourceVersion: projected.provenance.sourceVersion,
    indexedAt: "2026-09-06T03:05:00.000Z",
    status: "current",
    reason: null,
  })
})

test("QEO-114 distinguishes stale, missing, and unavailable CURRENT_THESIS projections", async () => {
  const projected = projectCurrentThesisKnowledge(THESIS)
  const stale = {
    ...projected,
    provenance: { ...projected.provenance, sourceVersion: "old-version" },
    indexedAt: "2026-09-05T03:00:00.000Z",
  }

  const staleStatus = await inspectCurrentThesisProjection(indexWithQuery(async () => [searchResult(stale)]), THESIS)
  assert.equal(staleStatus.status, "stale")
  assert.equal(staleStatus.indexedSourceVersion, "old-version")

  const missingStatus = await inspectCurrentThesisProjection(indexWithQuery(async () => []), THESIS)
  assert.equal(missingStatus.status, "missing")
  assert.equal(missingStatus.indexedSourceVersion, null)

  const unavailableStatus = await inspectCurrentThesisProjection(indexWithQuery(async () => {
    throw new TickerKnowledgeUnavailableError("qdrant_unavailable", "offline")
  }), THESIS)
  assert.equal(unavailableStatus.status, "unavailable")
  assert.equal(unavailableStatus.reason, "qdrant_unavailable")
})

test("QEO-114 rebuild restores a deleted deterministic CURRENT_THESIS point from canonical Notion", async () => {
  const points = new Map<string, TickerKnowledgeItem>()
  let canonicalReads = 0
  const index: TickerKnowledgeIndex = {
    ensureReady: async () => undefined,
    upsert: async (items) => {
      for (const item of items) points.set(item.id, item)
    },
    deleteSourceVersion: async () => undefined,
    query: async () => [],
  }
  const loadCanonicalTheses = async () => {
    canonicalReads += 1
    return [THESIS]
  }

  const first = await rebuildCurrentThesisKnowledge({ index, loadCanonicalTheses })
  const pointId = first.rows[0].pointId
  assert.equal(points.has(pointId), true)

  points.clear()
  assert.equal(points.has(pointId), false)

  const rebuilt = await rebuildCurrentThesisKnowledge({ index, loadCanonicalTheses })
  assert.equal(points.has(pointId), true)
  assert.equal(rebuilt.rows[0].pointId, pointId)
  assert.equal(rebuilt.rows[0].sourceVersion, first.rows[0].sourceVersion)
  assert.equal(canonicalReads, 2)
})
