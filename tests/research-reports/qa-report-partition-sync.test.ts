import assert from "node:assert/strict"
import test from "node:test"

import { assembleResearchReportProjectionInputs } from "../../modules/ticker-knowledge/canonical.ts"
import type { TickerKnowledgeItem } from "../../modules/ticker-knowledge/domain.ts"
import { syncResearchReportKnowledge } from "../../modules/ticker-knowledge/sync.ts"

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

test("QEO-116 canonical report assembly keeps uncited exact-version chunks for full-report Q&A", () => {
  const [input] = assembleResearchReportProjectionInputs({
    reports: [{
      id: REPORT_ID,
      title: "Full report",
      source_name: "Broker",
      publish_date: "2026-09-05",
      content_hash: HASH,
      analysis_status: "ready",
    }],
    analyses: [{
      id: ANALYSIS_ID,
      report_id: REPORT_ID,
      content_hash: HASH,
      chunk_version: CHUNK_VERSION,
      executive_summary: "Summary",
      processed_at: "2026-09-05T02:00:00Z",
      created_at: "2026-09-05T01:00:00Z",
    }],
    mentions: [{
      analysis_id: ANALYSIS_ID,
      ticker: "MSN",
      stance: "positive",
      rationale: "Broker view",
      evidence: [{ page: 1, snippet: "Only page 1 is cited by structured analysis" }],
    }],
    chunks: [{
      id: "44444444-4444-4444-8444-444444444444",
      report_id: REPORT_ID,
      content_hash: HASH,
      chunk_version: CHUNK_VERSION,
      page_number: 1,
      chunk_index: 0,
      content: "Cited page content",
      chunk_hash: "1".repeat(64),
    }, {
      id: "55555555-5555-4555-8555-555555555555",
      report_id: REPORT_ID,
      content_hash: HASH,
      chunk_version: CHUNK_VERSION,
      page_number: 2,
      chunk_index: 0,
      content: "Uncited page content needed for user Q&A",
      chunk_hash: "2".repeat(64),
    }],
  })

  assert.ok(input)
  assert.deepEqual(input.chunks.map((chunk) => chunk.pageNumber), [1, 2])
  assert.deepEqual(input.chunks.map((chunk) => chunk.content), [
    "Cited page content",
    "Uncited page content needed for user Q&A",
  ])
})
