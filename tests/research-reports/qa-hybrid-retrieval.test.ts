import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import test from "node:test"

import {
  RESEARCH_REPORT_QA_PARTITION,
  retrieveResearchReportQaHybridEvidence,
} from "../../modules/research-reports/qa/hybrid-retrieval.ts"
import { hydrateResearchReportQaEvidence } from "../../modules/research-reports/qa/retrieval.ts"
import type {
  ResearchReportQaEvidenceIdentity,
  ResearchReportQaRetrievalClient,
} from "../../modules/research-reports/qa/types.ts"
import { createTickerKnowledgeItem } from "../../modules/ticker-knowledge/domain.ts"
import { projectResearchReportKnowledge } from "../../modules/ticker-knowledge/projections.ts"

const REPORT_ID = "11111111-1111-4111-8111-111111111111"
const ANALYSIS_ID = "33333333-3333-4333-8333-333333333333"
const CHUNK_A = "44444444-4444-4444-8444-444444444444"
const CHUNK_B = "55555555-5555-4555-8555-555555555555"
const BAD_CHUNK = "66666666-6666-4666-8666-666666666666"
const HASH = "a".repeat(64)
const OLD_HASH = "b".repeat(64)
const CHUNK_VERSION = "report-chunk-v1"

const IDENTITY: ResearchReportQaEvidenceIdentity = {
  reportId: REPORT_ID,
  contentHash: HASH,
  chunkVersion: CHUNK_VERSION,
  analysisId: ANALYSIS_ID,
}

function qeo116HydrationMigration() {
  const directories = ["supabase/migrations", "supabase/pending-migrations"].filter(existsSync)
  const matches = directories.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith("_qeo116_report_qa_hydration.sql"))
      .map((name) => `${directory}/${name}`),
  )
  assert.equal(matches.length, 1, "expected exactly one QEO-116 report Q&A hydration migration")
  return readFileSync(matches[0], "utf8")
}

test("QEO-116 hydration RPC is exact-version and service-role-only", () => {
  const sql = qeo116HydrationMigration()
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.qeo_hydrate_research_report_chunks\s*\(/i)
  assert.match(sql, /p_report_id\s+uuid/i)
  assert.match(sql, /p_content_hash\s+text/i)
  assert.match(sql, /p_chunk_version\s+text/i)
  assert.match(sql, /p_chunk_ids\s+uuid\[\]/i)
  assert.match(sql, /c\.report_id\s*=\s*p_report_id/i)
  assert.match(sql, /c\.content_hash\s*=\s*p_content_hash/i)
  assert.match(sql, /c\.chunk_version\s*=\s*p_chunk_version/i)
  assert.match(sql, /c\.id\s*=\s*any\s*\(\s*p_chunk_ids\s*\)/i)
  assert.match(sql, /revoke\s+all\s+on\s+function\s+public\.qeo_hydrate_research_report_chunks[\s\S]*?from\s+public,\s*anon,\s*authenticated/i)
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.qeo_hydrate_research_report_chunks[\s\S]*?to\s+service_role/i)
})

test("QEO-116 hydrates canonical PostgreSQL text/page in Qdrant rank order and rejects identity leakage", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client: ResearchReportQaRetrievalClient = {
    from() {
      throw new Error("from() must not be used by hydration")
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return {
        error: null,
        data: [
          {
            id: CHUNK_A,
            report_id: REPORT_ID,
            content_hash: HASH,
            chunk_version: CHUNK_VERSION,
            page_number: 7,
            chunk_index: 1,
            content: "Canonical PostgreSQL text A",
          },
          {
            id: CHUNK_B,
            report_id: REPORT_ID,
            content_hash: HASH,
            chunk_version: CHUNK_VERSION,
            page_number: 9,
            chunk_index: 0,
            content: "Canonical PostgreSQL text B",
          },
          {
            id: BAD_CHUNK,
            report_id: REPORT_ID,
            content_hash: OLD_HASH,
            chunk_version: CHUNK_VERSION,
            page_number: 99,
            chunk_index: 0,
            content: "Historical row must never hydrate",
          },
        ],
      }
    },
  }

  const evidence = await hydrateResearchReportQaEvidence(client, IDENTITY, [
    { chunkId: CHUNK_B, rank: 0.91 },
    { chunkId: CHUNK_A, rank: 0.82 },
    { chunkId: BAD_CHUNK, rank: 0.99 },
  ])

  assert.deepEqual(rpcCalls, [{
    name: "qeo_hydrate_research_report_chunks",
    args: {
      p_report_id: REPORT_ID,
      p_content_hash: HASH,
      p_chunk_version: CHUNK_VERSION,
      p_chunk_ids: [CHUNK_B, CHUNK_A, BAD_CHUNK],
    },
  }])
  assert.deepEqual(evidence.map((row) => row.chunkId), [CHUNK_B, CHUNK_A])
  assert.deepEqual(evidence.map((row) => row.rank), [0.91, 0.82])
  assert.equal(evidence[0].page, 9)
  assert.equal(evidence[0].content, "Canonical PostgreSQL text B")
  assert.equal(evidence[1].page, 7)
  assert.equal(evidence[1].content, "Canonical PostgreSQL text A")
  assert.doesNotMatch(evidence.map((row) => row.content).join(" "), /Historical row/)
})

test("QEO-116 projects every report chunk once into the deterministic REPORT partition", () => {
  const projected = projectResearchReportKnowledge({
    report: {
      id: REPORT_ID,
      title: "MSN valuation update",
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
    chunks: [
      { id: CHUNK_A, pageNumber: 7, chunkIndex: 1, content: "Chunk A", chunkHash: "1".repeat(64) },
      { id: CHUNK_B, pageNumber: 9, chunkIndex: 0, content: "Chunk B", chunkHash: "2".repeat(64) },
    ],
  })

  const reportChunks = projected.filter((item) => item.ticker === RESEARCH_REPORT_QA_PARTITION && item.knowledgeType === "REPORT_CHUNK")
  assert.deepEqual(reportChunks.map((item) => item.provenance.chunkId), [CHUNK_A, CHUNK_B])
  assert.ok(reportChunks.every((item) => item.provenance.reportId === REPORT_ID))
  assert.ok(reportChunks.every((item) => item.provenance.analysisId === ANALYSIS_ID))
  assert.ok(reportChunks.every((item) => item.provenance.contentHash === HASH))
  assert.ok(reportChunks.every((item) => item.provenance.chunkVersion === CHUNK_VERSION))
})

test("QEO-116 report hybrid retrieval uses REPORT + exact provenance and never trusts Qdrant text/page", async () => {
  const sourceVersion = `${HASH}:${ANALYSIS_ID}:${CHUNK_VERSION}`
  const qdrantItem = createTickerKnowledgeItem({
    ticker: RESEARCH_REPORT_QA_PARTITION,
    knowledgeType: "REPORT_CHUNK",
    authority: "SOURCE_OPINION",
    sourceType: "RESEARCH_REPORT",
    logicalKey: "report-qa-a",
    text: "FORGED Qdrant text must never reach the model",
    provenance: {
      sourceId: REPORT_ID,
      sourceVersion,
      contentHash: HASH,
      reportId: REPORT_ID,
      analysisId: ANALYSIS_ID,
      chunkVersion: CHUNK_VERSION,
      page: 999,
      chunkId: CHUNK_A,
      chunkIndex: 999,
    },
    projectionVersion: "test-v1",
  })
  const queries: Array<Record<string, unknown>> = []
  const index = {
    ensureReady: async () => undefined,
    upsert: async () => undefined,
    deleteSourceVersion: async () => undefined,
    query: async (input: Record<string, unknown>) => {
      queries.push(input)
      return [{
        id: qdrantItem.id,
        score: 0.87,
        item: qdrantItem,
        derivedVersions: { embeddingModel: "x", embeddingVersion: "x", sparseEncoder: "x", sparseVersion: "x" },
      }]
    },
  }
  const client: ResearchReportQaRetrievalClient = {
    from() {
      throw new Error("from() must not be used")
    },
    async rpc(name, args) {
      assert.equal(name, "qeo_hydrate_research_report_chunks")
      assert.deepEqual(args, {
        p_report_id: REPORT_ID,
        p_content_hash: HASH,
        p_chunk_version: CHUNK_VERSION,
        p_chunk_ids: [CHUNK_A],
      })
      return {
        error: null,
        data: [{
          id: CHUNK_A,
          report_id: REPORT_ID,
          content_hash: HASH,
          chunk_version: CHUNK_VERSION,
          page_number: 7,
          chunk_index: 1,
          content: "Canonical PostgreSQL text A",
        }],
      }
    },
  }

  const result = await retrieveResearchReportQaHybridEvidence(index, client, IDENTITY, "mục tiêu định giá")

  assert.equal(result.status, "ready")
  assert.equal(queries.length, 1)
  assert.deepEqual(queries[0], {
    ticker: RESEARCH_REPORT_QA_PARTITION,
    text: "mục tiêu định giá",
    knowledgeTypes: ["REPORT_CHUNK"],
    sourceTypes: ["RESEARCH_REPORT"],
    reportId: REPORT_ID,
    analysisId: ANALYSIS_ID,
    sourceId: REPORT_ID,
    sourceVersion,
    contentHash: HASH,
    chunkVersion: CHUNK_VERSION,
    asOf: undefined,
    limit: 8,
  })
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].page, 7)
  assert.equal(result.evidence[0].content, "Canonical PostgreSQL text A")
  assert.doesNotMatch(result.evidence[0].content, /FORGED/)
})
