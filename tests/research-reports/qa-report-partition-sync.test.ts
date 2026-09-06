import assert from "node:assert/strict"
import test from "node:test"

import { syncResearchReportKnowledge } from "../../modules/ticker-knowledge/sync.ts"
import type { TickerKnowledgeItem } from "../../modules/ticker-knowledge/domain.ts"

const REPORT_ID = "11111111-1111-4111-8111-111111111111"
const ANALYSIS_ID = "33333333-3333-4333-8333-333333333333"
const HASH = "a".repeat(64)
const CHUNK_VERSION = "report-chunk-v1"

test("QEO-116 large report projection is upserted in bounded <=64 point batches", async () => {
  const batches: TickerKnowledgeItem[][] = []
  const chunks = Array.from({ length: 130 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
    pageNumber: index + 1,
    chunkIndex: 0,
    content: `Report chunk ${index + 1}`,
    chunkHash: index.toString(16).padStart(64, "0").slice(-64),
  }))
  const index = {
    ensureReady: async () => undefined,
    upsert: async (items: readonly TickerKnowledgeItem[]) => {
      assert.ok(items.length <= 64, `upsert batch exceeded provider limit: ${items.length}`)
      batches.push([...items])
    },
    query: async () => [],
    deleteSourceVersion: async () => undefined,
  }

  const result = await syncResearchReportKnowledge(index, {
    report: {
      id: REPORT_ID,
      title: "Long report",
      sourceName: "Broker",
      publishDate: "2026-09-05",
      contentHash: HASH,
    },
    analysis: {
      id: ANALYSIS_ID,
      chunkVersion: CHUNK_VERSION,
      executiveSummary: "Summary",
      keyPoints: [],
      marketView: null,
      sectorOutlook: null,
      catalysts: [],
      risks: [],
    },
    mentions: [],
    chunks,
  })

  assert.deepEqual(batches.map((batch) => batch.length), [64, 64, 2])
  assert.equal(result.upserted, 130)
  assert.equal(result.itemIds.length, 130)
  assert.equal(new Set(result.itemIds).size, 130)
})
